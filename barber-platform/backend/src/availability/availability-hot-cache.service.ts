import { Injectable } from '@nestjs/common';
import { ComputedAvailabilityService } from './computed-availability.service';
import { TimeSlotService } from './time-slot.service';
import {
  CacheService,
  getAvailabilityTimeSlotsCacheTtlSec,
} from '../redis/cache.service';

export type TimeSlotsDayRedisBlob = {
  v: 1;
  byService: Record<string, string[]>;
};

export function parseTimeSlotsDayBlob(
  raw: unknown,
): TimeSlotsDayRedisBlob | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || o.byService == null || typeof o.byService !== 'object') {
    return null;
  }

  const byService = o.byService as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const [sid, arr] of Object.entries(byService)) {
    if (!Array.isArray(arr) || !arr.every((x) => typeof x === 'string')) {
      return null;
    }
    out[sid] = arr;
  }
  return { v: 1, byService: out };
}

/**
 * Booking Core Stable v1
 * Frozen after correctness/performance validation.
 * Modify cautiously.
 */
@Injectable()
export class AvailabilityHotCacheService {
  private readonly blockMinutesCache = new Map<
    string,
    { value: number | null; expiresAt: number }
  >();

  private static readonly BLOCK_CACHE_MS = 10 * 60 * 1000;

  constructor(
    private readonly cache: CacheService,
    private readonly computedAvailability: ComputedAvailabilityService,
    private readonly timeSlots: TimeSlotService,
  ) {}

  async getBlockMinutesCached(
    businessId: string,
    staffId: string,
    serviceId: string,
  ): Promise<number | null> {
    const key = `${businessId}:${staffId}:${serviceId}`;
    const cached = this.blockMinutesCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value =
      await this.computedAvailability.getEffectiveBookingBlockMinutesForStaffService(
        businessId,
        staffId,
        serviceId,
      );
    this.blockMinutesCache.set(key, {
      value,
      expiresAt: Date.now() + AvailabilityHotCacheService.BLOCK_CACHE_MS,
    });
    return value;
  }

  async getBlob(
    businessId: string,
    staffId: string,
    dateYmd: string,
  ): Promise<TimeSlotsDayRedisBlob | null> {
    const raw = await this.cache.get<unknown>(
      CacheService.keys.availabilityHotDay(businessId, staffId, dateYmd),
    );
    return parseTimeSlotsDayBlob(raw);
  }

  async setBlob(
    businessId: string,
    staffId: string,
    dateYmd: string,
    blob: TimeSlotsDayRedisBlob,
  ): Promise<void> {
    await this.cache.set(
      CacheService.keys.availabilityHotDay(businessId, staffId, dateYmd),
      blob,
      getAvailabilityTimeSlotsCacheTtlSec(),
    );
  }

  async refreshCachedServicesForDay(
    businessId: string,
    staffId: string,
    dateYmd: string,
  ): Promise<void> {
    const blob = await this.getBlob(businessId, staffId, dateYmd);
    if (!blob) return;

    const serviceIds = Object.keys(blob.byService);
    if (serviceIds.length === 0) return;

    const nextByService: Record<string, string[]> = {};
    for (const serviceId of serviceIds) {
      const blockMinutes = await this.getBlockMinutesCached(
        businessId,
        staffId,
        serviceId,
      );
      nextByService[serviceId] =
        blockMinutes != null
          ? await this.timeSlots.getFreeSlotsForBookingBlock(
              staffId,
              dateYmd,
              blockMinutes,
            )
          : await this.timeSlots.getFreeSlots(staffId, dateYmd);
    }

    await this.setBlob(businessId, staffId, dateYmd, {
      v: 1,
      byService: nextByService,
    });
  }
}
