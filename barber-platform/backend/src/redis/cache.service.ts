import { Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { RedisService } from './redis.service';
import { CacheBustMetricsService } from './cache-bust-metrics.service';
import { addRedisCallCount } from '../common/request-context';

/** TTL in seconds */
export const CACHE_TTL = {
  BUSINESS: 600,      // 10 min
  STAFF_LIST: 300,    // 5 min
  SERVICES_LIST: 300, // 5 min
  APPOINTMENTS_DAY: 60, // 1 min
  AVAILABILITY: 60,   // legacy key TTL
  /** Cache-aside for precomputed slot grid — stale reads OK until confirm/cancel/admin bust. */
  AVAILABILITY_GRID: 45,
  /** Default TTL for computed availability (GET /availability); busted on book/cancel. Higher = better hit ratio under read-heavy load. */
  AVAILABILITY_COMPUTED: 45,
  /** Merged bookings + holds + breaks (minutes) per staff/day — short TTL; busted on book/hold/reschedule. */
  AVAILABILITY_BUSY_INTERVALS: 30,
  SLOT_LOCK: 600,     // 10 min (booking lock)
  WAITLIST_RESERVE: 900, // 15 min (waitlist slot reserve)
  /** Soft gate: only one in-flight confirm per slot (NX); DB remains source of truth. */
  CONFIRM_GUARD: 5,
  /** Staff validation bundle (working hours, breaks, overrides, services) per staff+date. */
  STAFF_VALIDATION_BUNDLE: 120,
} as const;

/**
 * Env: AVAILABILITY_COMPUTED_CACHE_TTL_SEC — 5–300 seconds (default follows CACHE_TTL.AVAILABILITY_COMPUTED).
 * Under high booking churn, use 30–90; under read-heavy traffic, higher TTL improves hit ratio until bust on write.
 */
export function getAvailabilityComputedCacheTtlSec(): number {
  const raw = process.env.AVAILABILITY_COMPUTED_CACHE_TTL_SEC;
  const v = raw != null && raw !== '' ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(v) && v >= 5 && v <= 300) return v;
  return CACHE_TTL.AVAILABILITY_COMPUTED;
}

/** Env: AVAILABILITY_BUSY_CACHE_TTL_SEC — 10–60 (default 30). Layer-1 busy intervals only. */
export function getAvailabilityBusyCacheTtlSec(): number {
  const raw = process.env.AVAILABILITY_BUSY_CACHE_TTL_SEC;
  const v = raw != null && raw !== '' ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(v) && v >= 10 && v <= 60) return v;
  return CACHE_TTL.AVAILABILITY_BUSY_INTERVALS;
}

/**
 * Full per-day slot grid (ComputedDayAvailability) — `av:day:*`.
 * Env: AVAILABILITY_DAY_FULL_CACHE_TTL_SEC — 30–60 (default 45); upper cap keeps UX reads fresh.
 */
export function getAvailabilityDayFullCacheTtlSec(): number {
  const raw = process.env.AVAILABILITY_DAY_FULL_CACHE_TTL_SEC;
  const v = raw != null && raw !== '' ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(v) && v >= 30 && v <= 60) return v;
  return 45;
}

/**
 * USE_TIME_SLOTS=1 hot path: `availability:{businessId}:{staffId}:{date}` JSON blob.
 * Env: AVAILABILITY_TIME_SLOTS_CACHE_TTL_SEC — 15–600 (default 60).
 */
export function getAvailabilityTimeSlotsCacheTtlSec(): number {
  const raw = process.env.AVAILABILITY_TIME_SLOTS_CACHE_TTL_SEC;
  const v = raw != null && raw !== '' ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(v) && v >= 15 && v <= 600) return v;
  return 60;
}

/**
 * Stale-projection guard window after reschedule (Phase 1.6).
 * Env: AVAILABILITY_RESCHEDULE_DIRTY_TTL_SEC — 5–180 (default 45).
 */
export function getAvailabilityRescheduleDirtyTtlSec(): number {
  const raw = process.env.AVAILABILITY_RESCHEDULE_DIRTY_TTL_SEC;
  const v = raw != null && raw !== '' ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(v) && v >= 5 && v <= 180) return v;
  return 45;
}

@Injectable()
export class CacheService {
  constructor(
    private readonly redis: RedisService,
    private readonly cacheBustMetrics: CacheBustMetricsService,
  ) {}

  private get client() {
    return this.redis.getClient();
  }

  private countRedisCall(count = 1): void {
    addRedisCallCount(count);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      this.countRedisCall();
      const raw = await this.client.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as T;
      }
    } catch {
      return null;
    }
  }

  /** Same order as keys; stub Redis falls back to parallel GET. */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    try {
      this.countRedisCall();
      const c = this.client as {
        mget?: (...k: string[]) => Promise<(string | null)[]>;
      };
      if (typeof c.mget === 'function') {
        const raw = await c.mget(...keys);
        return raw.map((r) => {
          if (r == null) return null;
          try {
            return JSON.parse(r) as T;
          } catch {
            return null;
          }
        });
      }
      return await Promise.all(keys.map((k) => this.get<T>(k)));
    } catch {
      return keys.map(() => null);
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      this.countRedisCall();
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
    } catch {
      // Redis unavailable - skip cache
    }
  }

  async del(key: string): Promise<void> {
    try {
      this.countRedisCall();
      await this.client.del(key);
    } catch {
      // Redis unavailable
    }
  }

  /** Single round-trip delete (no SCAN). Stub/real Redis both support variadic `del`. */
  async delMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      this.countRedisCall();
      await this.client.del(...keys);
    } catch {
      // Redis unavailable
    }
  }

  /**
   * SET key NX EX — returns true if acquired. If Redis fails, returns true (fail-open).
   */
  async tryAcquireConfirmGuard(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      this.countRedisCall();
      const r = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
      return r === 'OK';
    } catch {
      return true;
    }
  }

  /**
   * Increment integer key and ensure it has TTL. Returns the new value.
   * Fail-open: returns null on Redis errors.
   */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number | null> {
    try {
      this.countRedisCall();
      const next = await this.client.incr(key);
      this.countRedisCall();
      const ttl = await this.client.ttl(key);
      if (ttl < 0) {
        this.countRedisCall();
        await this.client.expire(key, ttlSeconds);
      }
      return next;
    } catch {
      return null;
    }
  }

  /**
   * Decrement integer key and delete when counter reaches <= 0.
   * Fail-open: returns null on Redis errors.
   */
  async decrAndDeleteWhenNonPositive(key: string): Promise<number | null> {
    try {
      const c = this.client as {
        decr?: (k: string) => Promise<number>;
        get: (k: string) => Promise<string | null>;
        set: (k: string, v: string) => Promise<unknown>;
        del: (...keys: string[]) => Promise<unknown>;
      };

      let next: number;
      if (typeof c.decr === 'function') {
        this.countRedisCall();
        next = await c.decr(key);
      } else {
        this.countRedisCall();
        const raw = await c.get(key);
        const curr = raw == null ? 0 : parseInt(raw, 10);
        next = curr - 1;
        this.countRedisCall();
        await c.set(key, String(next));
      }

      if (next <= 0) {
        this.countRedisCall();
        await c.del(key);
      }
      return next;
    } catch {
      return null;
    }
  }

  /**
   * Short-lived Redis mutex with owner token. Returns null when another request already owns the slot.
   * Fail-open on Redis errors to preserve availability/correctness via DB constraints.
   */
  async tryAcquireShortLock(
    key: string,
    ttlSeconds: number,
  ): Promise<string | null> {
    const token = randomUUID();
    try {
      this.countRedisCall();
      const r = await this.client.set(key, token, 'EX', ttlSeconds, 'NX');
      return r === 'OK' ? token : null;
    } catch {
      return token;
    }
  }

  /**
   * Best-effort safe release: delete only if the same token still owns the lock.
   * Real Redis uses EVAL compare+delete; stubs fall back to GET + DEL.
   */
  async releaseShortLock(key: string, token: string): Promise<void> {
    try {
      const c = this.client as {
        eval?: (
          script: string,
          numKeys: number,
          ...args: string[]
        ) => Promise<unknown>;
        get: (key: string) => Promise<string | null>;
        del: (...keys: string[]) => Promise<unknown>;
      };

      if (typeof c.eval === 'function') {
        this.countRedisCall();
        await c.eval(
          `
            if redis.call('GET', KEYS[1]) == ARGV[1] then
              return redis.call('DEL', KEYS[1])
            end
            return 0
          `,
          1,
          key,
          token,
        );
        return;
      }

      this.countRedisCall();
      const current = await c.get(key);
      if (current === token) {
        this.countRedisCall();
        await c.del(key);
      }
    } catch {
      // Redis unavailable
    }
  }

  /**
   * Delete keys matching pattern. Uses SCAN + UNLINK on real Redis (non-blocking, no global KEYS lock).
   * In-memory stub falls back to KEYS + DEL.
   *
   * @param bustLabel — when set, records duration in {@link CacheBustMetricsService} and optional JSON log.
   */
  async delPattern(pattern: string, bustLabel?: string): Promise<void> {
    const t0 = bustLabel ? performance.now() : 0;
    try {
      const c = this.client as unknown as {
        scan?: (
          cursor: string,
          ...args: (string | number)[]
        ) => Promise<[string, string[]]>;
        unlink?: (...keys: string[]) => Promise<unknown>;
        keys: (p: string) => Promise<string[]>;
        del: (...keys: string[]) => Promise<unknown>;
      };
      if (typeof c.scan === 'function') {
        let cursor = '0';
        do {
          this.countRedisCall();
          const [next, keys] = await c.scan(
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            128,
          );
          cursor = next;
          if (keys.length > 0) {
            if (typeof c.unlink === 'function') {
              this.countRedisCall();
              await c.unlink(...keys);
            } else {
              this.countRedisCall();
              await c.del(...keys);
            }
          }
        } while (cursor !== '0');
        this.recordDelPatternDone(bustLabel, t0);
        return;
      }
      this.countRedisCall();
      const keys = await c.keys(pattern);
      if (keys.length > 0) {
        this.countRedisCall();
        await c.del(...keys);
      }
      this.recordDelPatternDone(bustLabel, t0);
    } catch {
      // Redis unavailable
      this.recordDelPatternDone(bustLabel, t0);
    }
  }

  private recordDelPatternDone(bustLabel: string | undefined, t0: number): void {
    if (!bustLabel || t0 <= 0) return;
    const ms = performance.now() - t0;
    this.cacheBustMetrics.recordDelPattern(bustLabel, ms);
    if (process.env.LOG_CACHE_BUST_PERF === '1') {
      try {
        process.stdout.write(
          `${JSON.stringify({
            type: 'cache_del_pattern',
            label: bustLabel,
            ms: Math.round(ms),
            patternRedacted: true,
          })}\n`,
        );
      } catch {
        /* ignore */
      }
    }
  }

  async invalidateBusiness(businessId: string): Promise<void> {
    try {
      await Promise.all([
        this.del(`business:id:${businessId}`),
        this.delPattern(`staff:list:${businessId}*`),
        this.delPattern(`services:list:${businessId}*`),
        this.delPattern(`appointments:*:${businessId}*`),
      ]);
    } catch {
      // Redis unavailable
    }
  }

  async invalidateBusinessBySlug(slug: string): Promise<void> {
    try {
      await this.del(`business:${slug}`);
    } catch {
      // Redis unavailable
    }
  }

  async invalidateStaff(staffId: string): Promise<void> {
    try {
      await this.delPattern(`availability:${staffId}:*`);
      await this.delPattern(`av:v2:${staffId}:*`);
      await this.delPattern(`av:v2r:*:${staffId}:*`);
      await this.delPattern(`av:busy:*:${staffId}:*`);
      await this.delPattern(`appointments:day:${staffId}:*`);
    } catch {
      // Redis unavailable
    }
  }

  async invalidateStaffValidationBundleForStaff(
    staffId: string,
    reason: string,
  ): Promise<void> {
    const pattern = CacheService.keys.staffValidationBundlePatternForStaff(staffId);
    try {
      await this.delPattern(pattern, 'bust_staff_validation_bundle_staff');
    } finally {
      this.logStaffValidationInvalidation({
        scope: 'staff',
        staffId,
        reason,
        pattern,
      });
    }
  }

  async invalidateStaffValidationBundleForDate(
    staffId: string,
    dateYmd: string,
    reason: string,
  ): Promise<void> {
    const key = CacheService.keys.staffValidationBundle(staffId, dateYmd);
    try {
      await this.del(key);
    } finally {
      this.logStaffValidationInvalidation({
        scope: 'date',
        staffId,
        dateYmd: dateYmd.slice(0, 10),
        reason,
        key,
      });
    }
  }

  private logStaffValidationInvalidation(input: {
    scope: 'staff' | 'date';
    staffId: string;
    reason: string;
    key?: string;
    pattern?: string;
    dateYmd?: string;
  }): void {
    try {
      process.stdout.write(
        `${JSON.stringify({
          event: 'VALIDATE_STAFF_CACHE_INVALIDATE',
          operation: 'cache_invalidation',
          phase: 'staff_validation_bundle_invalidate',
          durationMs: 0,
          totalDurationMs: 0,
          ...input,
        })}\n`,
      );
    } catch {
      /* ignore */
    }
  }

  async invalidateAvailability(staffId: string, date?: string): Promise<void> {
    try {
      if (date) {
        await this.del(`availability:${staffId}:${date}`);
        await this.delPattern(`av:v2:${staffId}:*:${date}`);
        await this.delPattern(`av:v2r:*:${staffId}:*`);
        await this.delPattern(`av:busy:*:${staffId}:${date}`);
        await this.delPattern(`av:day:*:${staffId}:*:${date.slice(0, 10)}`);
        await this.del(`appointments:day:${staffId}:${date}`);
      } else {
        await this.delPattern(`availability:${staffId}:*`);
        await this.delPattern(`av:v2:${staffId}:*`);
        await this.delPattern(`av:v2r:*:${staffId}:*`);
        await this.delPattern(`av:busy:*:${staffId}:*`);
        await this.delPattern(`av:day:*:${staffId}:*`);
        await this.delPattern(`appointments:day:${staffId}:*`);
      }
    } catch {
      // Redis unavailable
    }
  }

  // --- Cache key builders ---

  static keys = {
    business: (slug: string) => `business:${slug}`,
    businessById: (id: string) => `business:id:${id}`,
    staffList: (businessId: string, branchId?: string, excludeManagers?: boolean) =>
      `staff:list:${businessId}:${branchId ?? 'all'}:${excludeManagers ? 'no-mgrs' : 'all'}`,
    servicesList: (businessId: string) => `services:list:${businessId}`,
    appointmentsDay: (staffId: string, date: string) =>
      `appointments:day:${staffId}:${date}`,
    availability: (staffId: string, date: string) =>
      `availability:${staffId}:${date}`,
    /** Serialized: Record<serviceId, string[]> — all AVAILABLE HH:mm starts for that staff/day. */
    availabilityGrid: (staffId: string, date: string) =>
      `availability:${staffId}:${date}`,
    /** Serialized ComputedDayAvailability — bust all services for staff+date on book. */
    availabilityComputed: (staffId: string, serviceId: string, date: string) =>
      `av:v2:${staffId}:${serviceId}:${date}`,
    availabilityComputedPatternForStaffDate: (staffId: string, date: string) =>
      `av:v2:${staffId}:*:${date}`,
    /**
     * Multi-day batch: Record<dateYmd, ComputedDayAvailability> — one Redis entry per (business, staff, service, start, n).
     */
    availabilityComputedRange: (
      businessId: string,
      staffId: string,
      serviceId: string,
      startYmd: string,
      dayCount: number,
    ) =>
      `av:v2r:${businessId}:${staffId}:${serviceId}:${startYmd}:n${dayCount}`,
    availabilityComputedRangePatternForStaff: (businessId: string, staffId: string) =>
      `av:v2r:${businessId}:${staffId}:*`,
    /**
     * Layer-1 cache: merged minute busy intervals [start,end) for one business-local day.
     * JSON: { v:1, i: [[startMin,endMin],...] } — serviceId not part of key.
     */
    availabilityBusyIntervals: (businessId: string, staffId: string, dateYmd: string) =>
      `av:busy:${businessId}:${staffId}:${dateYmd.slice(0, 10)}`,
    availabilityBusyIntervalsPatternForStaffDate: (staffId: string, dateYmd: string) =>
      `av:busy:*:${staffId}:${dateYmd.slice(0, 10)}`,
    /** Full ComputedDayAvailability JSON `{ v:1, d: {...} }` — bust all services for staff+day on write. */
    availabilityDayFull: (
      businessId: string,
      staffId: string,
      serviceId: string,
      dateYmd: string,
    ) =>
      `av:day:${businessId}:${staffId}:${serviceId}:${dateYmd.slice(0, 10)}`,
    staffValidationBundle: (staffId: string, dateYmd: string) =>
      `staff_val:${staffId}:${dateYmd.slice(0, 10)}`,
    staffValidationBundlePatternForStaff: (staffId: string) =>
      `staff_val:${staffId}:*`,
    availabilityDayFullPatternForStaff: (businessId: string, staffId: string) =>
      `av:day:${businessId}:${staffId}:*`,
    /** All full-day entries for one business-local day (every serviceId). Safe bust when shared busy changes. */
    availabilityDayFullPatternForStaffDate: (
      businessId: string,
      staffId: string,
      dateYmd: string,
    ) =>
      `av:day:${businessId}:${staffId}:*:${dateYmd.slice(0, 10)}`,
    /**
     * Hot GET /availability (time_slots path): `{ v:1, byService: { [serviceId]: HH:mm[] } }`.
     * Bust: single DEL per staff-day — {@link BookingService.bustTimeSlotsReadCache}.
     */
    availabilityHotDay: (
      businessId: string,
      staffId: string,
      dateYmd: string,
    ) =>
      `availability:${businessId}:${staffId}:${dateYmd.slice(0, 10)}`,
    /** Phase 1.6 stale-indication counter for staff/day after reschedule write. */
    availabilityRescheduleDirtyDay: (
      businessId: string,
      staffId: string,
      dateYmd: string,
    ) =>
      `av:dirty:reschedule:${businessId}:${staffId}:${dateYmd.slice(0, 10)}`,
    /**
     * Narrow stale windows for staff/day after writes.
     * JSON: { v:1, w:[[startMin,endMin],...] } in business-local minutes.
     */
    availabilityRescheduleDirtyWindows: (
      businessId: string,
      staffId: string,
      dateYmd: string,
    ) =>
      `av:dirty:reschedule:windows:${businessId}:${staffId}:${dateYmd.slice(0, 10)}`,
    slotAttemptLock: (staffId: string, dateYmd: string, hhmm: string) =>
      `lock:slot:${staffId}:${dateYmd.slice(0, 10)}:${hhmm}`,
  };
}
