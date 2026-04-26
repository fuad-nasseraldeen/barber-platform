import { performance } from 'node:perf_hooks';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SLOT_ASSERT_UNAVAILABLE_MESSAGE } from '../booking/booking-lock.errors';
import { utcNowJsDate, wallClockMs } from '../common/time';
import {
  CACHE_TTL,
  CacheService,
  getAvailabilityBusyCacheTtlSec,
  getAvailabilityDayFullCacheTtlSec,
} from '../redis/cache.service';
import { AvailabilityMetricsService } from './availability-metrics.service';
import { getAvailabilitySlotStepMinutes } from '../common/availability-slot-interval';
import {
  addBusinessDaysFromYmd,
  businessLocalDayBounds,
  businessLocalDayOfWeek,
  businessLocalYmdFromJsDate,
  formatInstantLocalHhmm,
  type HolidayCheckRow,
  isCalendarDayHolidayInZone,
  isSlotBlockWithinWorkingMinutes,
  resolveScheduleWallClockZone,
  resolveStaffWorkingHoursForBusinessLocalDay,
  wallHhmmStringToMinuteOfDay,
} from '../common/business-local-time';
import {
  ensureValidBusinessZone,
  formatBusinessTime,
  getBusinessNow,
  getStartOfDay,
  isWithinBusinessBookingWindow,
} from '../common/time-engine';
import {
  buildSlotDistributionReport,
  findOfferedSlotOverlaps,
  formatSlotDistributionHistogram,
  hhmmToMinutes,
  hourDistributionPercentages,
  limitSlotsPerWallClockHour,
  minutesToHhmm,
  subtractRanges,
  totalBookedMinutesUtcDay,
  type TimeRangeMin,
} from './simple-availability.engine';
import {
  appointmentsToMinuteIntervalsOnBusinessLocalDay,
  mergeMinuteIntervals,
  slotBlockFitsAnyFreeSegment,
  subtractIntervals,
  type MinuteInterval,
} from './interval-availability.engine';
import {
  computeSlotStartsFromWorkingAndBusy,
  countSlotStartsInFreeIntervals,
} from './business-local-interval-availability.engine';
import {
  rankOfferedSlotMinutesByFragmentation,
} from './slot-fragmentation';
import { writePerfNdjson } from '../common/perf-ndjson';
import { getRequestId } from '../common/request-context';
import type { AvailabilityDayMapTimingHeader } from './availability-http-timing.types';

type BookingSpan = {
  startTime: Date;
  endTime: Date;
  source?: 'appointment' | 'slot_hold' | 'buffer';
};

/**
 * Booking Core Stable v1
 * Frozen after correctness/performance validation.
 * Modify cautiously.
 */
/** Full-day grid cache envelope — {@link ComputedDayAvailability} in `d`. */
type FullDayAvailabilityCachePayload = {
  v: 1;
  d: ComputedDayAvailability;
};

/** Redis layer-1: merged subtract intervals + appt/hold-only for fragmentation ranking. */
type BusyIntervalsCachePayload = {
  v: 1;
  /** Full busy (breaks + exceptions + appointments + holds), minute ranges from local midnight. */
  s: Array<[number, number]>;
  /** Appointments + holds only (same timeline), for {@link rankOfferedSlotMinutesByFragmentation}. */
  r: Array<[number, number]>;
};

export type ComputedDayAvailability = {
  slots: string[];
  staffFirstName?: string;
  staffLastName?: string;
  /**
   * Internal snapshot aligned with slot generation (not serialized to clients).
   * Enables hold validation to call the same predicates as {@link validateAndLogOfferedSlots}.
   */
  _holdEngine?: {
    workingStartMin: number;
    workingEndMin: number;
    durationMinutes: number;
    freeIntervalsAfterBusyMin: MinuteInterval[];
  };
};

type StaffAvailabilityBundle = Prisma.StaffGetPayload<{
  include: {
    staffWorkingHours: true;
    staffWorkingHoursDateOverrides: true;
    staffBreaks: true;
    staffBreakExceptions: true;
    staffTimeOff: true;
    staffServices: {
      where: { serviceId: string; allowBooking: boolean };
      select: {
        durationMinutes: true;
        allowBooking: true;
        service: {
          select: {
            durationMinutes: true;
            bufferBeforeMinutes: true;
            bufferAfterMinutes: true;
            deletedAt: true;
          };
        };
      };
    };
  };
}>;

/**
 * One staff + service + day range.
 * Layer 1 (cacheable): merged busy intervals (bookings + holds + breaks) per business day — Redis, keyed by business + staff + date (no serviceId).
 * Layer 2: slot grid + fragmentation ranking in memory (minutes / no Date in inner loops).
 * DB: one union query for appointments + holds (on cache miss) + staff bundle + holidays in parallel with it.
 */
@Injectable()
export class ComputedAvailabilityService {
  private readonly logger = new Logger(ComputedAvailabilityService.name);
  private lastValidationCacheReadMs = 0;
  private lastValidationRebuildMs = 0;
  private lastValidationCacheHit = false;
  private lastValidationCacheKey: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
    private readonly availabilityMetrics: AvailabilityMetricsService,
  ) {}

  getLastValidationCacheReadMs(): number {
    return this.lastValidationCacheReadMs;
  }

  getLastValidationRebuildMs(): number {
    return this.lastValidationRebuildMs;
  }

  getLastValidationCacheHit(): boolean {
    return this.lastValidationCacheHit;
  }

  getLastValidationCacheKey(): string | null {
    return this.lastValidationCacheKey;
  }

  private emitStructuredEvent(payload: Record<string, unknown>): void {
    try {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } catch {
      /* ignore */
    }
  }

  /**
   * Booking window is defined in **business local calendar days** (not server midnight / UTC date).
   */
  isWithinBookingWindow(dateStr: string, timeZone: string): boolean {
    const raw = this.config.get('BOOKING_WINDOW_DAYS', '90');
    const windowDays = parseInt(raw, 10) || 90;
    const z = ensureValidBusinessZone(timeZone);
    return isWithinBusinessBookingWindow(dateStr.slice(0, 10), z, windowDays);
  }

  /**
   * Staff–service block length (core duration + buffers) for UTC overlap checks; aligns with booking reschedule validation+holds.
   */
  async getEffectiveBookingBlockMinutesForStaffService(
    businessId: string,
    staffId: string,
    serviceId: string,
  ): Promise<number | null> {
    const ss = await this.prisma.staffService.findFirst({
      where: {
        staffId,
        serviceId,
        allowBooking: true,
        staff: { businessId, isActive: true, deletedAt: null },
        service: { deletedAt: null },
      },
      select: {
        durationMinutes: true,
        service: {
          select: {
            durationMinutes: true,
            bufferBeforeMinutes: true,
            bufferAfterMinutes: true,
          },
        },
      },
    });
    if (!ss) return null;
    const coreMinutes = Math.max(
      1,
      ss.durationMinutes > 0
        ? ss.durationMinutes
        : ss.service.durationMinutes > 0
          ? ss.service.durationMinutes
          : 1,
    );
    return (
      coreMinutes +
      (ss.service.bufferBeforeMinutes ?? 0) +
      (ss.service.bufferAfterMinutes ?? 0)
    );
  }

  /**
   * One UNION (appointments + active holds) for a UTC half-open window — DB truth for read-repair after cache.
   */
  async getReadRepairOccupiedUtcSpans(
    businessId: string,
    staffId: string,
    rangeStartInclusive: Date,
    rangeEndExclusive: Date,
  ): Promise<BookingSpan[]> {
    const { appts, holds } = await this.fetchAppointmentAndHoldSpans(
      businessId,
      staffId,
      rangeStartInclusive,
      rangeEndExclusive,
      utcNowJsDate(),
    );
    return appts.concat(holds);
  }

  /**
   * Drop HH:mm offers whose [start, start+block) UTC overlaps any occupied span (same rule as slot-hold clash).
   */
  filterOfferedSlotsReadRepair(
    slots: string[],
    dateStrYmd: string,
    timeZone: string,
    blockMinutes: number,
    occupiedUtc: BookingSpan[],
  ): string[] {
    if (!slots.length || !occupiedUtc.length) return slots;
    const debugOn = process.env.RESCHEDULE_DEBUG === '1';
    const debugWallSlot = (process.env.RESCHEDULE_DEBUG_WALL_SLOT || '09:00').trim();
    const ymd = dateStrYmd.slice(0, 10);
    const z = ensureValidBusinessZone(timeZone);
    if (debugOn) {
      this.logger.log(
        JSON.stringify({
          type: 'RESCHEDULE_DEBUG',
          phase: 'availability_read_repair_before_filter',
          requestId: getRequestId(),
          dateYmd: ymd,
          blockMinutes,
          candidateSlotsFirst20: slots.slice(0, 20),
          occupiedRangesFirst20: occupiedUtc.slice(0, 20).map((o) => ({
            source: o.source ?? 'buffer',
            start: o.startTime.toISOString(),
            end: o.endTime.toISOString(),
          })),
        }),
      );
    }
    return slots.filter((hhmm) => {
      if (typeof hhmm !== 'string' || hhmm.length < 5) return true;
      const wall = getStartOfDay(ymd, z).set({
        hour: parseInt(hhmm.slice(0, 2), 10),
        minute: parseInt(hhmm.slice(3, 5), 10),
        second: 0,
        millisecond: 0,
      });
      const slotStart = wall.toUTC().toJSDate();
      const slotEnd = new Date(slotStart.getTime() + blockMinutes * 60_000);
      for (const o of occupiedUtc) {
        const overlaps = slotStart < o.endTime && slotEnd > o.startTime;
        if (debugOn && hhmm === debugWallSlot) {
          this.logger.log(
            JSON.stringify({
              type: 'RESCHEDULE_DEBUG',
              phase: 'availability_read_repair_overlap_check',
              oldSlot: debugWallSlot,
              slotWall: hhmm,
              slotStart: slotStart.toISOString(),
              slotEnd: slotEnd.toISOString(),
              occupiedStart: o.startTime.toISOString(),
              occupiedEnd: o.endTime.toISOString(),
              source: o.source ?? 'buffer',
              overlaps,
            }),
          );
        }
        if (overlaps) {
          if (debugOn && hhmm === debugWallSlot) {
            this.logger.log(
              JSON.stringify({
                type: 'RESCHEDULE_DEBUG',
                phase: 'availability_read_repair_slot_removed',
                oldSlot: debugWallSlot,
                reasonBlocked: 'overlap_with_occupied_range',
                source: o.source ?? 'buffer',
                blockingRange: {
                  start: o.startTime.toISOString(),
                  end: o.endTime.toISOString(),
                },
                slotRange: {
                  start: slotStart.toISOString(),
                  end: slotEnd.toISOString(),
                },
              }),
            );
          }
          return false;
        }
      }
      if (debugOn && hhmm === debugWallSlot) {
        this.logger.log(
          JSON.stringify({
            type: 'RESCHEDULE_DEBUG',
            phase: 'availability_read_repair_slot_kept',
            oldSlot: debugWallSlot,
            reasonBlocked: null,
            source: null,
            slotRange: {
              start: slotStart.toISOString(),
              end: slotEnd.toISOString(),
            },
          }),
        );
      }
      return true;
    });
  }

  /**
   * Single-day API (legacy caller). Same as a 1-day batch.
   */
  async getAvailability(
    staffId: string,
    serviceId: string,
    dateStr: string,
    businessId: string,
  ): Promise<ComputedDayAvailability> {
    const ymd = dateStr.slice(0, 10);
    const map = await this.getAvailabilityDayMap(
      businessId,
      staffId,
      serviceId,
      ymd,
      1,
    );
    return map.get(ymd) ?? { slots: [] };
  }

  /** @deprecated Delegate to {@link validateSlotHoldBusinessRules} — no cache/engine check. */
  async assertSlotHoldOfferedByAvailabilityEngine(input: {
    businessId: string;
    staffId: string;
    serviceId: string;
    dateYmd: string;
    wallStartHhmm: string;
    durationMinutesFromClient: number;
    slotStartMinLocal: number;
    timezoneDebug?: {
      localStartIso: string | null;
      localEndIso: string | null;
      utcStartIso: string | null;
      utcEndIso: string | null;
    };
  }): Promise<void> {
    return this.validateSlotHoldBusinessRules(input);
  }

  /**
   * Pure business-rule validation for slot holds — all checks from DB, **no cache / availability engine**.
   *
   * Validates: wall-time parse, booking window, staff+service active, duration match,
   * working hours window, and break/exception overlap.
   *
   * The DB `EXCLUDE` constraint on `slot_holds` is the sole arbiter of hold-vs-hold and
   * hold-vs-appointment conflicts (→ 409). This method only catches genuine 400-level errors
   * (bad input, outside working hours, during a break, etc.).
   */
  async validateSlotHoldBusinessRules(input: {
    businessId: string;
    staffId: string;
    serviceId: string;
    dateYmd: string;
    wallStartHhmm: string;
    durationMinutesFromClient: number;
    slotStartMinLocal: number;
    timezoneDebug?: {
      localStartIso: string | null;
      localEndIso: string | null;
      utcStartIso: string | null;
      utcEndIso: string | null;
    };
    /** Pre-resolved IANA zone from caller — skips a `findUnique(business)` round-trip. */
    resolvedTimeZone?: string;
  }): Promise<void> {
    this.lastValidationCacheReadMs = 0;
    this.lastValidationRebuildMs = 0;
    this.lastValidationCacheHit = false;
    this.lastValidationCacheKey = null;
    const ymd = input.dateYmd.slice(0, 10);
    const startNorm = input.wallStartHhmm.trim();
    const slotStartMin = input.slotStartMinLocal;

    const timeZone = input.resolvedTimeZone
      ? ensureValidBusinessZone(input.resolvedTimeZone)
      : ensureValidBusinessZone(
          resolveScheduleWallClockZone(
            (await this.prisma.business.findUnique({
              where: { id: input.businessId },
              select: { timezone: true },
            }))?.timezone,
          ),
        );
    const timeZoneLog = { businessTimezone: timeZone, ...(input.timezoneDebug ?? {}) };

    const wallParseMin = wallHhmmStringToMinuteOfDay(startNorm);
    if (wallParseMin !== slotStartMin) {
      this.logSlotHoldReject({
        failureReason: 'wall_minutes_parse_mismatch',
        wallStartHhmm: startNorm,
        wallHhmmStringToMinuteOfDay: wallParseMin,
        slotStartMinLocal: slotStartMin,
        dateYmd: ymd,
        staffId: input.staffId,
        serviceId: input.serviceId,
        ...timeZoneLog,
      });
      throw new BadRequestException('Invalid slot wall time');
    }

    if (!this.isWithinBookingWindow(ymd, timeZone)) {
      throw new BadRequestException('Date is outside the booking window');
    }

    const { startMs: holdDayStartMs, endMs: holdDayEndExMs } = businessLocalDayBounds(
      timeZone,
      ymd,
    );
    const holdRangeStart = new Date(holdDayStartMs);
    const holdRangeEndExclusive = new Date(holdDayEndExMs);

    const tStaffQ0 = wallClockMs();
    const bundleCacheKey = CacheService.keys.staffValidationBundle(input.staffId, ymd);
    this.lastValidationCacheKey = bundleCacheKey;

    const fetchStaffBundle = () =>
      this.prisma.staff.findFirst({
        where: {
          id: input.staffId,
          businessId: input.businessId,
          isActive: true,
          deletedAt: null,
        },
        include: {
          staffWorkingHours: true,
          staffWorkingHoursDateOverrides: {
            where: {
              date: { gte: holdRangeStart, lt: holdRangeEndExclusive },
            },
          },
          staffBreaks: {
            where: { staffId: input.staffId },
          },
          staffBreakExceptions: {
            where: {
              staffId: input.staffId,
              date: { gte: holdRangeStart, lt: holdRangeEndExclusive },
            },
          },
          staffServices: {
            select: {
              durationMinutes: true,
              allowBooking: true,
              serviceId: true,
              service: {
                select: {
                  durationMinutes: true,
                  bufferBeforeMinutes: true,
                  bufferAfterMinutes: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
      });

    type StaffBundleRow = NonNullable<Awaited<ReturnType<typeof fetchStaffBundle>>>;

    let staffRow: StaffBundleRow | null = await this.cache.get<StaffBundleRow>(bundleCacheKey);
    this.lastValidationCacheReadMs = wallClockMs() - tStaffQ0;
    const cacheHit = !!staffRow;
    this.lastValidationCacheHit = cacheHit;

    if (!staffRow) {
      const tRebuild0 = wallClockMs();
      staffRow = await fetchStaffBundle();
      this.lastValidationRebuildMs = wallClockMs() - tRebuild0;
      if (staffRow) {
        void this.cache.set(bundleCacheKey, staffRow, CACHE_TTL.STAFF_VALIDATION_BUNDLE);
      }
    }

    if (process.env.LOG_SLOT_HOLD_PERF === '1') {
      this.emitStructuredEvent({
        event: 'VALIDATE_STAFF_QUERY',
        operation: 'POST /appointments/slot-holds',
        phase: 'staff_validation_bundle',
        durationMs: Math.round(wallClockMs() - tStaffQ0),
        totalDurationMs: Math.round(wallClockMs() - tStaffQ0),
        cacheReadDurationMs: Math.round(this.lastValidationCacheReadMs),
        rebuildDurationMs: Math.round(this.lastValidationRebuildMs),
        businessId: input.businessId,
        staffId: input.staffId,
        serviceId: input.serviceId,
        date: ymd,
        slotTime: startNorm,
        cacheHit,
        cacheKey: bundleCacheKey,
        whRows: staffRow?.staffWorkingHours?.length ?? 0,
        breakRows: staffRow?.staffBreaks?.length ?? 0,
        breakExRows: staffRow?.staffBreakExceptions?.length ?? 0,
        overrideRows: staffRow?.staffWorkingHoursDateOverrides?.length ?? 0,
        svcRows: staffRow?.staffServices?.length ?? 0,
      });
    }

    const ss0 = staffRow?.staffServices?.find(
      (ss) => ss.serviceId === input.serviceId && ss.allowBooking,
    );
    if (!staffRow || !ss0?.service || ss0.service.deletedAt) {
      throw new BadRequestException('Staff or service is not available for booking');
    }

    const serviceMinutes = Math.max(
      1,
      (ss0.durationMinutes > 0 ? ss0.durationMinutes : ss0.service.durationMinutes) || 1,
    );
    const effectiveDuration =
      serviceMinutes +
      (ss0.service.bufferBeforeMinutes ?? 0) +
      (ss0.service.bufferAfterMinutes ?? 0);

    if (input.durationMinutesFromClient !== effectiveDuration) {
      this.logSlotHoldReject({
        failureReason: 'duration_mismatch',
        slotStart: startNorm,
        slotStartMin,
        slotEndMin: slotStartMin + effectiveDuration,
        workingStartMin: null,
        workingEndMin: null,
        workingStartWall: null,
        workingEndWall: null,
        inWorkingWindow: null,
        inOfferedSet: null,
        dateYmd: ymd,
        staffId: input.staffId,
        serviceId: input.serviceId,
        effectiveDurationMinutes: effectiveDuration,
        clientDurationMinutes: input.durationMinutesFromClient,
        ...timeZoneLog,
      });
      throw new BadRequestException(
        `durationMinutes must be ${effectiveDuration} for this service (includes buffers)`,
      );
    }

    const durEff = Math.max(1, Math.floor(Math.trunc(effectiveDuration)));
    const slotEndMin = slotStartMin + durEff;

    const dow = businessLocalDayOfWeek(timeZone, ymd);
    const wh = resolveStaffWorkingHoursForBusinessLocalDay({
      ymd,
      timeZone,
      weeklyRows: staffRow.staffWorkingHours,
      dateOverrides: staffRow.staffWorkingHoursDateOverrides ?? [],
    });

    if (!wh) {
      this.logger.warn(
        `missing working hours ${JSON.stringify({ staffId: input.staffId, date: ymd })}`,
      );
      this.logSlotHoldReject({
        failureReason: 'no_working_hours_for_day',
        slotStart: startNorm,
        slotStartMin,
        slotEndMin,
        workingStartMin: null,
        workingEndMin: null,
        workingStartWall: null,
        workingEndWall: null,
        inWorkingWindow: false,
        inOfferedSet: false,
        dateYmd: ymd,
        staffId: input.staffId,
        serviceId: input.serviceId,
        dayOfWeekLocal: dow,
        effectiveDurationMinutes: effectiveDuration,
        clientDurationMinutes: input.durationMinutesFromClient,
        ...timeZoneLog,
      });
      throw new BadRequestException(SLOT_ASSERT_UNAVAILABLE_MESSAGE);
    }

    const workingStartMin = wallHhmmStringToMinuteOfDay(wh.startTime);
    const workingEndMin = wallHhmmStringToMinuteOfDay(wh.endTime);
    const inWh = isSlotBlockWithinWorkingMinutes(
      slotStartMin,
      effectiveDuration,
      workingStartMin,
      workingEndMin,
    );

    if (!inWh) {
      this.logSlotHoldReject({
        failureReason: 'outside_working_window',
        slotStart: startNorm,
        slotStartMin,
        slotEndMin,
        workingStartMin,
        workingEndMin,
        workingStartWall: wh.startTime,
        workingEndWall: wh.endTime,
        inWorkingWindow: false,
        inOfferedSet: false,
        dateYmd: ymd,
        staffId: input.staffId,
        serviceId: input.serviceId,
        dayOfWeekLocal: dow,
        effectiveDurationMinutes: effectiveDuration,
        clientDurationMinutes: input.durationMinutesFromClient,
        ...timeZoneLog,
      });
      throw new BadRequestException(
        `Slot is outside working hours (${wh.startTime}-${wh.endTime})`,
      );
    }

    const weeklyBreaks: TimeRangeMin[] = (staffRow.staffBreaks ?? [])
      .filter((b) => b.dayOfWeek === dow)
      .map((b) => ({ start: hhmmToMinutes(b.startTime), end: hhmmToMinutes(b.endTime) }));
    const exBreaks: TimeRangeMin[] = (staffRow.staffBreakExceptions ?? [])
      .filter((e) => businessLocalYmdFromJsDate(timeZone, e.date) === ymd)
      .map((e) => ({ start: hhmmToMinutes(e.startTime), end: hhmmToMinutes(e.endTime) }));
    const allBreaks = [...weeklyBreaks, ...exBreaks];

    for (const br of allBreaks) {
      if (slotStartMin < br.end && slotEndMin > br.start) {
        this.logSlotHoldReject({
          failureReason: 'overlaps_break',
          slotStart: startNorm,
          slotStartMin,
          slotEndMin,
          breakStartMin: br.start,
          breakEndMin: br.end,
          dateYmd: ymd,
          staffId: input.staffId,
          serviceId: input.serviceId,
          dayOfWeekLocal: dow,
          ...timeZoneLog,
        });
        throw new BadRequestException('Slot overlaps a scheduled break');
      }
    }
  }

  private logSlotHoldReject(payload: Record<string, unknown>): void {
    this.logger.warn(JSON.stringify({ type: 'SLOT_HOLD_REJECT', ...payload }));
  }

  /**
   * LOG_AVAILABILITY_INTERNAL_TIMING=1 — console JSON: total / redis(cache) / db / busyPrep / compute(slots).
   * BOOKING_PERF_LOG=1 — same numbers as NDJSON line (BookingPerfInterceptor requestId).
   */
  private emitAvailabilityBreakdown(
    payload: Record<string, unknown>,
    timingHeaderSink?: AvailabilityDayMapTimingHeader,
  ): void {
    const num = (k: string): number =>
      typeof payload[k] === 'number' ? (payload[k] as number) : 0;
    if (timingHeaderSink) {
      timingHeaderSink.path = String(payload.path ?? '');
      timingHeaderSink.totalMs = num('totalMs');
      timingHeaderSink.redisMs = num('cacheMs');
      timingHeaderSink.dbMs = num('dbMs');
      timingHeaderSink.busyPrepMs = num('busyPrepMs');
      timingHeaderSink.computeMs = num('filterMs');
      if (typeof payload.remainderMs === 'number') {
        timingHeaderSink.remainderMs = payload.remainderMs;
      } else {
        delete timingHeaderSink.remainderMs;
      }
    }
    if (process.env.LOG_AVAILABILITY_INTERNAL_TIMING === '1') {
      const total = num('totalMs');
      const redis = num('cacheMs');
      const db = num('dbMs');
      const busyPrep = num('busyPrepMs');
      const compute = num('filterMs');
      const remainder =
        typeof payload.remainderMs === 'number' ? (payload.remainderMs as number) : undefined;
      console.log(
        JSON.stringify({
          type: 'AVAILABILITY_INTERNAL_TIMING',
          requestId: getRequestId(),
          path: payload.path,
          total,
          redis,
          db,
          busyPrep,
          compute,
          ...(remainder !== undefined ? { remainder } : {}),
        }),
      );
    }
    if (process.env.BOOKING_PERF_LOG !== '1') return;
    writePerfNdjson({ type: 'availability_breakdown', ...payload });
  }

  /**
   * Consecutive calendar days in the business timezone from `startYmd` (length N).
   * Full-day Redis hits short-circuit only when layer-1 busy entries exist for those days (same churn boundary).
   * `dbAuthoritative`: skip Redis for full-day + busy (hold assertion / strict read) — UNION appointments+holds from DB.
   */
  async getAvailabilityDayMap(
    businessId: string,
    staffId: string,
    serviceId: string,
    startYmd: string,
    dayCount: number,
    opts?: {
      dbAuthoritative?: boolean;
      businessTimeZone?: string;
      /** When set (e.g. GET /availability with `AVAILABILITY_TIMING_RESPONSE_HEADER=1`), filled on exit. */
      timingHeaderSink?: AvailabilityDayMapTimingHeader;
      /** Collector: if provided, filled with occupied spans from the DB fetch (avoids duplicate UNION in read-repair). */
      occupiedSpansSink?: { appts: BookingSpan[]; holds: BookingSpan[]; effectiveBlockMinutes: number | null };
    },
  ): Promise<Map<string, ComputedDayAvailability>> {
    const operation = 'GET /availability';
    const timingHeaderSink = opts?.timingHeaderSink;
    const trackMs =
      process.env.BOOKING_PERF_LOG === '1' ||
      process.env.LOG_AVAILABILITY_INTERNAL_TIMING === '1' ||
      !!timingHeaderSink;
    const tPerf0 = performance.now();
    const br = trackMs ? { cache: 0, db: 0, busyPrep: 0 } : null;
    let slotComputeMsSum = 0;
    const tDb = async <T>(fn: () => Promise<T>): Promise<T> => {
      if (!br) return fn();
      const s = performance.now();
      try {
        return await fn();
      } finally {
        br.db += performance.now() - s;
      }
    };
    const tCache = async <T>(fn: () => Promise<T>): Promise<T> => {
      if (!br) return fn();
      const s = performance.now();
      try {
        return await fn();
      } finally {
        br.cache += performance.now() - s;
      }
    };

    const mapWallT0 = wallClockMs();
    const dbWallT0 = mapWallT0;
    const n = Math.max(1, Math.min(7, dayCount));
    const base = startYmd.slice(0, 10);

    const timeZone = opts?.businessTimeZone
      ? ensureValidBusinessZone(resolveScheduleWallClockZone(opts.businessTimeZone))
      : ensureValidBusinessZone(
          resolveScheduleWallClockZone(
            (
              await tDb(() =>
                this.prisma.business.findUnique({
                  where: { id: businessId },
                  select: { timezone: true },
                }),
              )
            )?.timezone,
          ),
        );

    const dates: string[] = [];
    for (let i = 0; i < n; i++) {
      dates.push(addBusinessDaysFromYmd(timeZone, base, i));
    }

    const out = new Map<string, ComputedDayAvailability>();
    for (const ds of dates) {
      out.set(ds, { slots: [] });
    }

    let anyInWindow = false;
    for (const ds of dates) {
      if (this.isWithinBookingWindow(ds, timeZone)) {
        anyInWindow = true;
        break;
      }
    }
    if (!anyInWindow) {
      for (const ymd of dates) {
        this.staffSlotsDevConsole(staffId, 0, {
          businessId,
          serviceId,
          dateStr: ymd,
          reason: 'outside_booking_window',
        });
      }
      this.emitAvailabilityBreakdown(
        {
          path: 'outside_booking_window',
          businessId,
          staffId,
          serviceId,
          dayCount: n,
          startYmd: base,
          totalMs: Math.round(performance.now() - tPerf0),
          cacheMs: br ? Math.round(br.cache) : 0,
          dbMs: br ? Math.round(br.db) : 0,
          busyPrepMs: 0,
          filterMs: 0,
        },
        timingHeaderSink,
      );
      return out;
    }

    const inWindowDates = dates.filter((d) => this.isWithinBookingWindow(d, timeZone));
    const ttlFullDay = getAvailabilityDayFullCacheTtlSec();
    const fullDayHits = new Set<string>();
    if (!opts?.dbAuthoritative) {
      const fullDayKeys = inWindowDates.map((ymd) =>
        CacheService.keys.availabilityDayFull(businessId, staffId, serviceId, ymd),
      );
      const fullDayRaw =
        fullDayKeys.length > 0
          ? await tCache(() => this.cache.mget<unknown>(fullDayKeys))
          : [];
      if (this.config.get<string>('LOG_AVAILABILITY_CACHE_DEBUG') === '1') {
        for (let i = 0; i < inWindowDates.length; i++) {
          const key = fullDayKeys[i]!;
          const cached = fullDayRaw[i];
          console.log('CACHE HIT?', !!cached, 'key', key);
        }
      }
      for (let i = 0; i < inWindowDates.length; i++) {
        const ymd = inWindowDates[i]!;
        const dayData = this.parseFullDayAvailabilityCache(fullDayRaw[i]);
        if (dayData) {
          out.set(ymd, dayData);
          fullDayHits.add(ymd);
        }
      }
    }

    if (
      !opts?.dbAuthoritative &&
      fullDayHits.size === inWindowDates.length &&
      inWindowDates.length > 0
    ) {
      const busyGateKeys = inWindowDates.map((ymd) =>
        CacheService.keys.availabilityBusyIntervals(businessId, staffId, ymd),
      );
      const busyGateRaw =
        busyGateKeys.length > 0
          ? await tCache(() =>
              this.cache.mget<BusyIntervalsCachePayload>(busyGateKeys),
            )
          : [];
      let busyLayerOk = true;
      for (let g = 0; g < busyGateRaw.length; g++) {
        if (!this.isBusyCachePayload(busyGateRaw[g])) {
          busyLayerOk = false;
          break;
        }
      }
      if (busyLayerOk) {
        const computeMs = wallClockMs() - mapWallT0;
        this.availabilityMetrics.recordFullDayCacheDays(fullDayHits.size, 0);
        this.availabilityMetrics.recordSlotQuery(computeMs, true);
        if (this.config.get<string>('LOG_AVAILABILITY_CACHE_DEBUG') === '1') {
          console.log(
            JSON.stringify({
              scope: 'ComputedAvailabilityService.getAvailabilityDayMap',
              fullDayCache: 'HIT',
              fullDayHits: fullDayHits.size,
              fullDayMisses: 0,
              busyLayerCache: 'HIT',
              computeMs,
              dayCount: n,
              businessId,
              staffId,
              serviceId,
              startYmd: base,
            }),
          );
        }
        let slotsTotal = 0;
        for (const ymd of inWindowDates) {
          slotsTotal += out.get(ymd)?.slots.length ?? 0;
        }
        this.emitAvailabilityBreakdown(
          {
            path: 'full_day_cache_hit',
            businessId,
            staffId,
            serviceId,
            dayCount: n,
            startYmd: base,
            totalMs: Math.round(performance.now() - tPerf0),
            cacheMs: br ? Math.round(br.cache) : 0,
            dbMs: br ? Math.round(br.db) : 0,
            busyPrepMs: 0,
            filterMs: 0,
            fullDayHits: fullDayHits.size,
            slotsTotal,
          },
          timingHeaderSink,
        );
        return out;
      }
      for (const ymd of inWindowDates) {
        fullDayHits.delete(ymd);
        out.set(ymd, { slots: [] });
      }
    }

    const missDates = inWindowDates.filter((d) => !fullDayHits.has(d));
    const missFirst = missDates[0]!;
    const missLast = missDates[missDates.length - 1]!;
    const missRangeStartMs = businessLocalDayBounds(timeZone, missFirst).startMs;
    const missRangeEndExclusiveMs = businessLocalDayBounds(timeZone, missLast).endMs;
    const missRangeStart = DateTime.fromMillis(missRangeStartMs, { zone: 'utc' }).toJSDate();
    const missRangeEndExclusive = DateTime.fromMillis(
      missRangeEndExclusiveMs,
      { zone: 'utc' },
    ).toJSDate();

    if (process.env.LOG_AVAILABILITY_RANGE_DEBUG === '1') {
      console.log(
        JSON.stringify({
          type: 'availability_query_day_range',
          rangeStart: missRangeStart.toISOString(),
          rangeEnd: missRangeEndExclusive.toISOString(),
          rangeEndNote:
            'EXCLUSIVE upper bound — appointments/holds use start < rangeEnd AND end > rangeStart; spans full business-local calendar day(s) missFirst→missLast, NOT clipped to now+hours',
          missFirst,
          missLast,
          timeZone,
          startYmd: base,
          dayCount: n,
        }),
      );
    }

    if (this.config.get<string>('LOG_AVAILABILITY_DB_BATCH') === '1') {
      console.log(
        'AVAILABILITY DB-batch: Redis layer-1 busy intervals + staff/holidays + optional UNION(appointments, slot_holds)',
      );
    }

    const now = utcNowJsDate();
    const busyKeys = missDates.map((ymd) =>
      CacheService.keys.availabilityBusyIntervals(businessId, staffId, ymd),
    );
    const cachedBusy = opts?.dbAuthoritative
      ? []
      : await tCache(() => this.cache.mget<BusyIntervalsCachePayload>(busyKeys));

    const busyByDate = new Map<string, { subtract: MinuteInterval[]; rank: MinuteInterval[] }>();
    let needBusyDb = false;
    for (let i = 0; i < missDates.length; i++) {
      const ymd = missDates[i]!;
      if (opts?.dbAuthoritative) {
        this.availabilityMetrics.recordBusyDayCache(false);
        needBusyDb = true;
        continue;
      }
      const raw = cachedBusy[i];
      if (this.isBusyCachePayload(raw)) {
        this.availabilityMetrics.recordBusyDayCache(true);
        busyByDate.set(ymd, {
          subtract: raw.s.map(([a, b]) => ({
            start: Math.trunc(Number(a)),
            end: Math.trunc(Number(b)),
          })),
          rank: raw.r.map(([a, b]) => ({
            start: Math.trunc(Number(a)),
            end: Math.trunc(Number(b)),
          })),
        });
      } else {
        this.availabilityMetrics.recordBusyDayCache(false);
        needBusyDb = true;
      }
    }

    if (process.env.LOG_AVAILABILITY_DIAG === '1') {
      console.log(
        JSON.stringify({
          type: 'availability_request_context',
          requestId: getRequestId(),
          businessId,
          staffId,
          serviceId,
          dateRange: { fromYmd: missFirst, toYmdInclusive: missLast },
          needBusyDb,
        }),
      );
    }

    const busyPromise = needBusyDb
      ?         this.fetchAppointmentAndHoldSpans(
          businessId,
          staffId,
          missRangeStart,
          missRangeEndExclusive,
          now,
        )
      : Promise.resolve({ appts: [] as BookingSpan[], holds: [] as BookingSpan[] });

    const tDbBatch0 = wallClockMs();
    const [[staffBundle, holidayRows], { appts: apptsRange, holds: holdsRange }] =
      await tDb(() =>
        Promise.all([
          Promise.all([
            this.prisma.staff.findUnique({
              where: { id: staffId, businessId, isActive: true, deletedAt: null },
              include: {
                staffWorkingHours: true,
                staffWorkingHoursDateOverrides: {
                  where: {
                    date: { gte: missRangeStart, lt: missRangeEndExclusive },
                  },
                },
                staffBreaks: true,
                staffBreakExceptions: {
                  where: {
                    date: { gte: missRangeStart, lt: missRangeEndExclusive },
                  },
                },
                staffTimeOff: {
                  where: {
                    status: 'APPROVED',
                    startDate: { lt: missRangeEndExclusive },
                    endDate: { gte: missRangeStart },
                  },
                },
                staffServices: {
                  where: { serviceId, allowBooking: true },
                  select: {
                    durationMinutes: true,
                    allowBooking: true,
                    service: {
                      select: {
                        durationMinutes: true,
                        bufferBeforeMinutes: true,
                        bufferAfterMinutes: true,
                        deletedAt: true,
                      },
                    },
                  },
                },
              },
            }),
            this.prisma.businessHoliday.findMany({
              where: {
                businessId,
                OR: [
                  {
                    isRecurring: false,
                    date: { gte: missRangeStart, lt: missRangeEndExclusive },
                  },
                  { isRecurring: true },
                ],
              },
              select: { date: true, isRecurring: true },
            }),
          ]),
          busyPromise,
        ]),
      );
    const dbBatchMs = wallClockMs() - tDbBatch0;
    this.emitStructuredEvent({
      event: 'AVAILABILITY_PHASE',
      operation,
      requestType: 'availability',
      phase: 'validation_staff_bundle_read',
      durationMs: Math.round(dbBatchMs),
      totalDurationMs: Math.round(wallClockMs() - mapWallT0),
      businessId,
      staffId,
      serviceId,
      date: missFirst,
      cacheHit: false,
      scenario: needBusyDb ? 'compute_with_appt_hold_union' : 'compute_busy_from_redis',
    });
    this.emitStructuredEvent({
      event: 'AVAILABILITY_PHASE',
      operation,
      requestType: 'availability',
      phase: 'validation_bundle_rebuild',
      durationMs: 0,
      totalDurationMs: Math.round(wallClockMs() - mapWallT0),
      businessId,
      staffId,
      serviceId,
      date: missFirst,
      scenario: 'not_cached_in_availability_path',
    });
    if (needBusyDb) {
      this.emitStructuredEvent({
        event: 'AVAILABILITY_PHASE',
        operation,
        requestType: 'availability',
        phase: 'appointments_holds_fetch',
        durationMs: Math.round(dbBatchMs),
        totalDurationMs: Math.round(wallClockMs() - mapWallT0),
        businessId,
        staffId,
        serviceId,
        date: missFirst,
        scenario: 'compute_with_appt_hold_union',
      });
    }

    // Fill collector for read-repair dedup (avoids a second UNION query in the caller)
    if (opts?.occupiedSpansSink) {
      opts.occupiedSpansSink.appts = apptsRange;
      opts.occupiedSpansSink.holds = holdsRange;
      const ss0 = staffBundle?.staffServices?.[0];
      if (ss0?.service && !ss0.service.deletedAt) {
        const coreDur = Math.max(
          1,
          (ss0.durationMinutes > 0 ? ss0.durationMinutes : ss0.service.durationMinutes) || 1,
        );
        opts.occupiedSpansSink.effectiveBlockMinutes =
          coreDur + (ss0.service.bufferBeforeMinutes ?? 0) + (ss0.service.bufferAfterMinutes ?? 0);
      } else {
        opts.occupiedSpansSink.effectiveBlockMinutes = null;
      }
    }

    const fn = staffBundle?.firstName;
    const ln = staffBundle?.lastName;
    const holidays = holidayRows as HolidayCheckRow[];
    const ttlBusy = getAvailabilityBusyCacheTtlSec();

    if (needBusyDb) {
      const tBusyPrep = br ? performance.now() : 0;
      for (const dateStr of missDates) {
        if (busyByDate.has(dateStr)) continue;

        const apptsDay = filterAppointmentsForBusinessLocalDay(apptsRange, dateStr, timeZone);
        const holdsDay = filterAppointmentsForBusinessLocalDay(holdsRange, dateStr, timeZone);
        const aphMin = mergeMinuteIntervals([
          ...appointmentsToMinuteIntervalsOnBusinessLocalDay(apptsDay, dateStr, timeZone),
          ...appointmentsToMinuteIntervalsOnBusinessLocalDay(holdsDay, dateStr, timeZone),
        ]);

        const sb = staffBundle as StaffAvailabilityBundle | null;
        const ymd = dateStr.slice(0, 10);
        const dow = businessLocalDayOfWeek(timeZone, ymd);
        const weekly: MinuteInterval[] =
          sb?.staffBreaks
            .filter((b) => b.dayOfWeek === dow)
            .map((b) => ({
              start: hhmmToMinutes(b.startTime),
              end: hhmmToMinutes(b.endTime),
            })) ?? [];
        const ex =
          sb?.staffBreakExceptions.filter(
            (e) => businessLocalYmdFromJsDate(timeZone, e.date) === ymd,
          ) ?? [];
        const exMin: MinuteInterval[] = ex.map((e) => ({
          start: hhmmToMinutes(e.startTime),
          end: hhmmToMinutes(e.endTime),
        }));
        const subtractFull = mergeMinuteIntervals([...aphMin, ...weekly, ...exMin]);
        busyByDate.set(dateStr, { subtract: subtractFull, rank: aphMin });
        if (staffBundle) {
          const payload: BusyIntervalsCachePayload = {
            v: 1,
            s: subtractFull.map((x) => [x.start, x.end] as [number, number]),
            r: aphMin.map((x) => [x.start, x.end] as [number, number]),
          };
          void this.cache.set(
            CacheService.keys.availabilityBusyIntervals(businessId, staffId, dateStr),
            payload,
            ttlBusy,
          );
        }
      }
      if (br) br.busyPrep += performance.now() - tBusyPrep;
    }

    const dbMs = wallClockMs() - dbWallT0;
    const allBusyFromCache = !needBusyDb;
    this.availabilityMetrics.recordSlotQuery(dbMs, allBusyFromCache);

    let fullDayMissCount = 0;
    let logFirstDayCompute = true;
    for (let i = 0; i < n; i++) {
      const dateStr = dates[i]!;
      if (!this.isWithinBookingWindow(dateStr, timeZone)) {
        this.staffSlotsDevConsole(staffId, 0, {
          businessId,
          serviceId,
          dateStr,
          reason: 'outside_booking_window',
        });
        continue;
      }

      if (fullDayHits.has(dateStr)) {
        continue;
      }

      const busy = busyByDate.get(dateStr);
      if (!busy) {
        const emptyDay: ComputedDayAvailability = {
          slots: [],
          staffFirstName: fn,
          staffLastName: ln,
        };
        out.set(dateStr, emptyDay);
        fullDayMissCount++;
        void this.cache.set(
          CacheService.keys.availabilityDayFull(businessId, staffId, serviceId, dateStr),
          { v: 1, d: emptyDay },
          ttlFullDay,
        );
        continue;
      }

      const apptsDay = needBusyDb
        ? filterAppointmentsForBusinessLocalDay(apptsRange, dateStr, timeZone)
        : [];
      const holdsDay = needBusyDb
        ? filterAppointmentsForBusinessLocalDay(holdsRange, dateStr, timeZone)
        : [];

      const computeT0 = wallClockMs();
      const slotT0 = trackMs ? performance.now() : 0;
      const dayComputed = this.computeOneDaySlots({
        businessId,
        staffId,
        serviceId,
        dateStr,
        timeZone,
        staffBundle: staffBundle as StaffAvailabilityBundle | null,
        appointmentsDay: apptsDay,
        activeHoldsDay: holdsDay,
        busySubtractMin: busy.subtract,
        busyRankMin: busy.rank,
        holidays,
        staffFirstName: fn,
        staffLastName: ln,
        logBusinessLocalDebug: logFirstDayCompute,
      });
      if (trackMs) slotComputeMsSum += performance.now() - slotT0;
      logFirstDayCompute = false;
      const dayComputeMs = wallClockMs() - computeT0;
      this.availabilityMetrics.recordSlotComputeMs(dayComputeMs);
      this.emitStructuredEvent({
        event: 'AVAILABILITY_PHASE',
        operation,
        requestType: 'availability',
        phase: 'slot_generation_filtering',
        durationMs: Math.round(dayComputeMs),
        totalDurationMs: Math.round(wallClockMs() - mapWallT0),
        businessId,
        staffId,
        serviceId,
        date: dateStr,
        scenario: needBusyDb ? 'compute_with_appt_hold_union' : 'compute_busy_from_redis',
      });
      out.set(dateStr, dayComputed);
      fullDayMissCount++;
        void this.cache.set(
          CacheService.keys.availabilityDayFull(businessId, staffId, serviceId, dateStr),
          { v: 1, d: dayComputed } as FullDayAvailabilityCachePayload,
          ttlFullDay,
        );
    }

    this.availabilityMetrics.recordFullDayCacheDays(fullDayHits.size, fullDayMissCount);

    if (this.config.get<string>('LOG_AVAILABILITY_CACHE_DEBUG') === '1') {
      const fdHit = fullDayHits.size;
      const fdMiss = fullDayMissCount;
      console.log(
        JSON.stringify({
          scope: 'ComputedAvailabilityService.getAvailabilityDayMap',
          fullDayCache: fdMiss === 0 ? 'HIT' : fdHit === 0 ? 'MISS' : 'PARTIAL',
          fullDayHits: fdHit,
          fullDayMisses: fdMiss,
          busyLayerCache: needBusyDb ? 'MISS' : 'HIT',
          computeMs: wallClockMs() - mapWallT0,
          dayCount: n,
          missDaysDbScope: missDates.length,
          businessId,
          staffId,
          serviceId,
          startYmd: base,
        }),
      );
    }

    let slotsTotalCompute = 0;
    for (const ds of dates) {
      if (!this.isWithinBookingWindow(ds, timeZone)) continue;
      slotsTotalCompute += out.get(ds)?.slots.length ?? 0;
    }
    this.emitAvailabilityBreakdown(
      {
        path: needBusyDb ? 'compute_with_appt_hold_union' : 'compute_busy_from_redis',
        businessId,
        staffId,
        serviceId,
        dayCount: n,
        startYmd: base,
        totalMs: Math.round(performance.now() - tPerf0),
        cacheMs: br ? Math.round(br.cache) : 0,
        dbMs: br ? Math.round(br.db) : 0,
        busyPrepMs: br ? Math.round(br.busyPrep) : 0,
        filterMs: Math.round(slotComputeMsSum),
        fullDayHits: fullDayHits.size,
        fullDayMisses: fullDayMissCount,
        needBusyDb,
        missDays: missDates.length,
        slotsTotal: slotsTotalCompute,
        remainderMs: Math.max(
          0,
          Math.round(
            performance.now() -
              tPerf0 -
              (br?.cache ?? 0) -
              (br?.db ?? 0) -
              (br?.busyPrep ?? 0) -
              slotComputeMsSum,
          ),
        ),
      },
      timingHeaderSink,
    );

    return out;
  }

  private parseFullDayAvailabilityCache(raw: unknown): ComputedDayAvailability | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as FullDayAvailabilityCachePayload;
    if (o.v !== 1 || !o.d || typeof o.d !== 'object') return null;
    const d = o.d as ComputedDayAvailability;
    if (!Array.isArray(d.slots)) return null;
    return d;
  }

  private isBusyCachePayload(x: unknown): x is BusyIntervalsCachePayload {
    if (!x || typeof x !== 'object') return false;
    const o = x as BusyIntervalsCachePayload;
    return o.v === 1 && Array.isArray(o.s) && Array.isArray(o.r);
  }

  private async fetchAppointmentAndHoldSpans(
    businessId: string,
    staffId: string,
    rangeStart: Date,
    rangeEndExclusive: Date,
    now: Date,
  ): Promise<{ appts: BookingSpan[]; holds: BookingSpan[] }> {
    if (process.env.LOG_AVAILABILITY_DIAG === '1') {
      console.log(
        JSON.stringify({
          type: 'availability_query_range',
          requestId: getRequestId(),
          businessId,
          staffId,
          from: rangeStart.toISOString(),
          to: rangeEndExclusive.toISOString(),
        }),
      );

      const [resultsOldQuery, resultsOverlapQuery] = await Promise.all([
        this.prisma.$queryRaw<Array<{ id: string; s: Date; e: Date }>>`
          SELECT a.id, a."startTime" AS s, a."endTime" AS e
          FROM appointments a
          WHERE a."staffId" = ${staffId}
            AND a."businessId" = ${businessId}
            AND a.status::text NOT IN ('CANCELLED', 'NO_SHOW')
            AND a."startTime" >= ${rangeStart}
            AND a."startTime" < ${rangeEndExclusive}
          ORDER BY a."startTime" ASC
        `,
        this.prisma.$queryRaw<Array<{ id: string; s: Date; e: Date }>>`
          SELECT a.id, a."startTime" AS s, a."endTime" AS e
          FROM appointments a
          WHERE a."staffId" = ${staffId}
            AND a."businessId" = ${businessId}
            AND a.status::text NOT IN ('CANCELLED', 'NO_SHOW')
            AND a."startTime" < ${rangeEndExclusive}
            AND a."endTime" > ${rangeStart}
          ORDER BY a."startTime" ASC
        `,
      ]);

      const toRow = (r: { id: string; s: Date; e: Date }) => ({
        id: r.id,
        start: r.s.toISOString(),
        end: r.e.toISOString(),
      });
      const oldIds = new Set(resultsOldQuery.map((r) => r.id));
      const overlapIds = new Set(resultsOverlapQuery.map((r) => r.id));
      const onlyInOverlapQuery = resultsOverlapQuery
        .filter((r) => !oldIds.has(r.id))
        .map(toRow);
      const onlyInOldQuery = resultsOldQuery
        .filter((r) => !overlapIds.has(r.id))
        .map(toRow);

      console.log(
        JSON.stringify({
          type: 'availability_appointments_start_vs_overlap_compare',
          requestId: getRequestId(),
          businessId,
          staffId,
          note:
            'results_old_query uses startTime >= from AND startTime < to; results_overlap_query uses startTime < to AND endTime > from (production path). onlyInOverlapQuery = spanning bookings the old filter misses.',
          results_old_query: resultsOldQuery.map(toRow),
          results_overlap_query: resultsOverlapQuery.map(toRow),
          onlyInOverlapQuery,
          onlyInOldQuery,
        }),
      );
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ kind: string; s: Date; e: Date; expires_at: Date | null }>
    >`
      SELECT * FROM (
        SELECT 'a' AS kind, a."startTime" AS s, a."endTime" AS e,
          CAST(NULL AS TIMESTAMP) AS expires_at
        FROM appointments a
        WHERE a."staffId" = ${staffId}
          AND a."businessId" = ${businessId}
          AND a.status::text NOT IN ('CANCELLED', 'NO_SHOW')
          AND a."startTime" < ${rangeEndExclusive}
          AND a."endTime" > ${rangeStart}
        UNION ALL
        SELECT 'h' AS kind, h.start_time AS s, h.end_time AS e, h.expires_at AS expires_at
        FROM slot_holds h
        WHERE h.staff_id = ${staffId}
          AND h.business_id = ${businessId}
          AND h.consumed_at IS NULL
          AND h.expires_at > ${now}
          AND h.start_time < ${rangeEndExclusive}
          AND h.end_time > ${rangeStart}
      ) x
    `;

    const appts: BookingSpan[] = [];
    const holds: BookingSpan[] = [];
    const holdRowsForDiag: Array<{
      start: string;
      end: string;
      expiresAt: string | null;
    }> = [];
    for (const r of rows) {
      if (!r.s || !r.e) continue;
      if (r.kind === 'a') appts.push({ startTime: r.s, endTime: r.e });
      else {
        holds.push({ startTime: r.s, endTime: r.e });
        if (process.env.LOG_AVAILABILITY_DIAG === '1') {
          holdRowsForDiag.push({
            start: r.s.toISOString(),
            end: r.e.toISOString(),
            expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
          });
        }
      }
    }

    if (process.env.LOG_AVAILABILITY_DIAG === '1') {
      console.log(
        JSON.stringify({
          type: 'availability_db_appointments',
          requestId: getRequestId(),
          businessId,
          staffId,
          count: appts.length,
          appointments: appts.map((a) => ({
            start: a.startTime.toISOString(),
            end: a.endTime.toISOString(),
          })),
        }),
      );
      console.log(
        JSON.stringify({
          type: 'availability_db_holds',
          requestId: getRequestId(),
          businessId,
          staffId,
          count: holds.length,
          holds: holdRowsForDiag,
        }),
      );
    }

    return { appts, holds };
  }

  private computeOneDaySlots(ctx: {
    businessId: string;
    staffId: string;
    serviceId: string;
    dateStr: string;
    timeZone: string;
    staffBundle: StaffAvailabilityBundle | null;
    appointmentsDay: BookingSpan[];
    activeHoldsDay: BookingSpan[];
    /** Layer 1: breaks + exceptions + appointments + holds (minutes), for subtracting from working window. */
    busySubtractMin: MinuteInterval[];
    /** Appointments + holds only — fragmentation ranking (excludes breaks). */
    busyRankMin: MinuteInterval[];
    holidays: HolidayCheckRow[];
    staffFirstName?: string | null;
    staffLastName?: string | null;
    logBusinessLocalDebug?: boolean;
  }): ComputedDayAvailability {
    const {
      businessId,
      staffId,
      serviceId,
      dateStr,
      timeZone,
      staffBundle,
      appointmentsDay,
      activeHoldsDay,
      busySubtractMin,
      busyRankMin,
      holidays,
    } = ctx;
    const fn = ctx.staffFirstName ?? undefined;
    const ln = ctx.staffLastName ?? undefined;
    const empty = (): ComputedDayAvailability => ({ slots: [], staffFirstName: fn, staffLastName: ln });

    if (!staffBundle) {
      this.staffSlotsDevConsole(staffId, 0, {
        businessId,
        serviceId,
        dateStr,
        reason: 'staff_not_found_or_inactive',
      });
      return empty();
    }

    const ss = staffBundle.staffServices[0];
    if (!ss?.service || ss.service.deletedAt) {
      this.staffSlotsDevConsole(staffId, 0, {
        businessId,
        serviceId,
        dateStr,
        reason: 'staff_missing_service_or_deleted',
      });
      return empty();
    }

    if (isCalendarDayHolidayInZone(dateStr, holidays, timeZone)) {
      this.staffSlotsDevConsole(staffId, 0, {
        businessId,
        serviceId,
        dateStr,
        reason: 'business_holiday',
      });
      return empty();
    }

    const ymd = dateStr.slice(0, 10);
    const { startMs: localDayStartMs, endMs: localDayEndExclusiveMs } = businessLocalDayBounds(
      timeZone,
      ymd,
    );
    const dayStart = DateTime.fromMillis(localDayStartMs, { zone: 'utc' }).toJSDate();
    const dayEnd = DateTime.fromMillis(localDayEndExclusiveMs, { zone: 'utc' }).toJSDate();
    const timeOffToday = staffBundle.staffTimeOff.filter(
      (t) => t.startDate < dayEnd && t.endDate >= dayStart,
    );
    if (isDayBlockedByTimeOff(timeOffToday)) {
      this.staffSlotsDevConsole(staffId, 0, {
        businessId,
        serviceId,
        dateStr,
        reason: 'staff_time_off',
      });
      return empty();
    }

    const dow = businessLocalDayOfWeek(timeZone, ymd);
    const wh = resolveStaffWorkingHoursForBusinessLocalDay({
      ymd,
      timeZone,
      weeklyRows: staffBundle.staffWorkingHours,
      dateOverrides: staffBundle.staffWorkingHoursDateOverrides ?? [],
    });
    if (!wh) {
      this.logger.warn(
        `missing working hours ${JSON.stringify({ staffId, date: ymd })}`,
      );
      this.staffSlotsDevConsole(staffId, 0, {
        businessId,
        serviceId,
        dateStr,
        reason: 'no_working_hours_for_dow',
        dayOfWeekLocal: dow,
      });
      return empty();
    }

    const breaks = staffBundle.staffBreaks.filter((b) => b.dayOfWeek === dow);
    const ex = staffBundle.staffBreakExceptions.filter(
      (e) => businessLocalYmdFromJsDate(timeZone, e.date) === ymd,
    );

    const serviceMinutes = Math.max(
      1,
      (ss.durationMinutes > 0 ? ss.durationMinutes : ss.service.durationMinutes) || 1,
    );
    const duration =
      serviceMinutes +
      (ss.service.bufferBeforeMinutes ?? 0) +
      (ss.service.bufferAfterMinutes ?? 0);
    const stepMinutes = getAvailabilitySlotStepMinutes(this.config);

    const weekly: TimeRangeMin[] = breaks.map((b) => ({
      start: hhmmToMinutes(b.startTime),
      end: hhmmToMinutes(b.endTime),
    }));
    const exMin: TimeRangeMin[] = ex.map((e) => ({
      start: hhmmToMinutes(e.startTime),
      end: hhmmToMinutes(e.endTime),
    }));

    const whStart = hhmmToMinutes(wh.startTime);
    const whEnd = hhmmToMinutes(wh.endTime);
    const afterBreaks = subtractRanges(
      { start: whStart, end: whEnd },
      [...weekly, ...exMin],
    );

    if (process.env.LOG_AVAILABILITY_RANGE_DEBUG === '1') {
      console.log(
        JSON.stringify({
          type: 'availability_working_window_for_slots',
          dateStr: ymd,
          staffId,
          serviceId,
          workingStartWall: wh.startTime,
          workingEndWall: wh.endTime,
          workingStartMin: whStart,
          workingEndMin: whEnd,
          breaksWeeklyCount: weekly.length,
          breakExceptionsTodayCount: exMin.length,
          freeSegmentsAfterBreaksMin: afterBreaks,
          note:
            'Slots are only generated inside [workingStartMin, workingEndMin) minus busy; DB query range is separate (full local day for fetching bookings)',
        }),
      );
    }
    const workingMinutes = Math.max(0, whEnd - whStart);
    const freeMinutes = afterBreaks.reduce(
      (acc, seg) => acc + Math.max(0, seg.end - seg.start),
      0,
    );
    const breakMinutes = Math.max(0, workingMinutes - freeMinutes);
    const bookedMinutes =
      appointmentsDay.length > 0
        ? totalBookedMinutesUtcDay(appointmentsDay)
        : sumMinuteIntervalLengths(busyRankMin);
    const serviceDuration = serviceMinutes;
    const bufferTime =
      (ss.service.bufferBeforeMinutes ?? 0) + (ss.service.bufferAfterMinutes ?? 0);

    const { startMs: dayStartUtcMs } = businessLocalDayBounds(timeZone, ymd);

    const freeAfterBookingsPreview = subtractIntervals(afterBreaks, busyRankMin);
    const businessNow = getBusinessNow(timeZone);
    this.logger.log(
      JSON.stringify({
        type: 'AVAILABILITY_COMPUTE',
        businessId,
        staffId,
        serviceId,
        dateStr: ymd,
        timezone: timeZone,
        businessNow: businessNow.toFormat('yyyy-MM-dd HH:mm'),
        bookingsInPipeline: appointmentsDay.length,
        activeHoldsOnDay: activeHoldsDay.length,
        freeIntervalsCount: freeAfterBookingsPreview.length,
        workingWindowMinutes: { start: whStart, end: whEnd },
      }),
    );

    for (const apt of appointmentsDay) {
      const sMin =
        (Math.max(apt.startTime.getTime(), dayStartUtcMs) - dayStartUtcMs) / 60_000;
      const eMin =
        (Math.min(apt.endTime.getTime(), localDayEndExclusiveMs) - dayStartUtcMs) / 60_000;
      if (sMin < whStart || eMin > whEnd) {
        this.logger.error(
          JSON.stringify({
            type: 'AVAILABILITY_WARNING_BOOKING_OUTSIDE_WH',
            message: 'Booking intersects day but wall span extends outside declared working hours (check timezone / data)',
            date: ymd,
            timezone: timeZone,
            workingHours: { start: wh.startTime, end: wh.endTime },
            booking: {
              startBusiness: formatBusinessTime(apt.startTime, timeZone),
              endBusiness: formatBusinessTime(apt.endTime, timeZone),
            },
            clippedMinutesApprox: { start: sMin, end: eMin },
          }),
        );
      }
    }

    if (
      ctx.logBusinessLocalDebug &&
      this.config.get<string>('LOG_AVAILABILITY_BUSINESS_LOCAL_DEBUG') === '1'
    ) {
      const freeAfterBookings = freeAfterBookingsPreview;
      console.log(
        '[availability-business-local-debug]',
        JSON.stringify(
          {
            dateStr: ymd,
            timeZone,
            dayOfWeekLocal: dow,
            workingHoursLocal: { start: wh.startTime, end: wh.endTime },
            bookingsLocal: appointmentsDay.map((a) => ({
              start: formatInstantLocalHhmm(a.startTime, timeZone),
              end: formatInstantLocalHhmm(a.endTime, timeZone),
            })),
            holdsLocal: activeHoldsDay.map((h) => ({
              start: formatInstantLocalHhmm(h.startTime, timeZone),
              end: formatInstantLocalHhmm(h.endTime, timeZone),
            })),
            freeIntervalsMin: freeAfterBookings,
          },
          null,
          2,
        ),
      );
    }

    if (process.env.AVAILABILITY_BUSY_SPAN_DEBUG === '1') {
      const spanIso = (b: BookingSpan) => ({
        startIso: b.startTime.toISOString(),
        endIso: b.endTime.toISOString(),
      });
      console.log(
        JSON.stringify({
          type: 'availability_busy_spans_before_slot_generation',
          businessId,
          staffId,
          serviceId,
          dateStr,
          timeZone,
          busySpansFromAvailability: {
            appointments: appointmentsDay.map(spanIso),
            slotHoldsCountedInPipeline: activeHoldsDay.map(spanIso),
            busySubtractMin,
            busyRankMin,
          },
        }),
      );
    }

    if (process.env.LOG_AVAILABILITY_DIAG === '1') {
      console.log(
        JSON.stringify({
          type: 'availability_input_to_core',
          requestId: getRequestId(),
          businessId,
          staffId,
          serviceId,
          date: ymd,
          timeZone,
          workingStart: whStart,
          workingEnd: whEnd,
          duration,
          stepMinutes,
          bookings: busyRankMin.map((x) => ({ start: x.start, end: x.end })),
          busySubtractIncludingBreaks: busySubtractMin.map((x) => ({
            start: x.start,
            end: x.end,
          })),
          pipelineAppointmentsDayCount: appointmentsDay.length,
          pipelineHoldsDayCount: activeHoldsDay.length,
        }),
      );
    }

    let {
      slotStartMinutes: offeredMinutes,
      freeIntervals: freeIntervalsAfterBusy,
    } = computeSlotStartsFromWorkingAndBusy(
      wh.startTime,
      wh.endTime,
      busySubtractMin,
      duration,
      stepMinutes,
    );
    const fragmentationRankOff = this.config.get<string>('AVAILABILITY_FRAGMENTATION_RANK') === '0';
    if (!fragmentationRankOff && offeredMinutes.length > 1) {
      const minServFrag = Math.max(
        1,
        parseInt(this.config.get<string>('AVAILABILITY_FRAGMENTATION_MIN_SERVICE_MINUTES') ?? '', 10) ||
          duration,
      );
      offeredMinutes = rankOfferedSlotMinutesByFragmentation(offeredMinutes, {
        freeSegments: afterBreaks,
        bookings: busyRankMin,
        duration,
        minServiceDuration: minServFrag,
        strictMode: false,
      });
    }
    const offeredCountBeforeHourCap = offeredMinutes.length;

    let slots = offeredMinutes.map((m) => minutesToHhmm(m));

    const rawMax = this.config.get<string>('AVAILABILITY_MAX_SLOTS_PER_HOUR', '0');
    const maxPerHour = parseInt(rawMax, 10);
    if (Number.isFinite(maxPerHour) && maxPerHour > 0) {
      slots = limitSlotsPerWallClockHour(slots, maxPerHour);
    }

    this.validateAndLogOfferedSlots({
      businessId,
      staffId,
      serviceId,
      dateStr,
      timeZone,
      dayStartUtcMs,
      workingStartMin: whStart,
      workingEndMin: whEnd,
      durationMinutesForAvailability: duration,
      generatedFree: freeIntervalsAfterBusy,
      freeIntervalsAfterBusyMin: freeIntervalsAfterBusy,
      slots,
    });

    const validSlots = slots.length;
    const distReport = buildSlotDistributionReport(slots);
    const totalCandidateSlots = countSlotStartsInFreeIntervals(
      afterBreaks,
      duration,
      stepMinutes,
    );
    const slotsAfterBookingFilter = countSlotStartsInFreeIntervals(
      subtractIntervals(afterBreaks, busyRankMin),
      duration,
      stepMinutes,
    );
    const entropyScore =
      totalCandidateSlots > 0
        ? Math.round((validSlots / totalCandidateSlots) * 10000) / 10000
        : 0;
    const bottleneckSummary = this.buildAvailabilityBottleneckSummary({
      workingMinutes,
      freeMinutes,
      breakMinutes,
      bookedMinutes,
      duration,
      serviceDuration,
      bufferTime,
      totalCandidateSlots,
      slotsAfterBookingFilter,
      slotsAfterNonOverlapPack: offeredCountBeforeHourCap,
      validSlots,
      stepMinutes,
    });

    this.emitStructuredAvailabilityDiagnostics({
      type: 'availability_entropy',
      businessId,
      staffId,
      serviceId,
      date: dateStr,
      workingMinutes,
      bookedMinutes,
      freeMinutes,
      breakMinutes,
      serviceDuration,
      bufferTime,
      effectiveDurationMinutes: duration,
      stepMinutes,
      totalCandidateSlots,
      slotsAfterBookingFilter,
      validSlots,
      slotsAfterNonOverlapPack: offeredCountBeforeHourCap,
      entropyScore,
      maxHourShare: distReport.maxHourShare,
      hourDistribution: hourDistributionPercentages(slots),
      greedyPack: false,
      bottleneckSummary,
    });

    if (process.env.LOG_AVAILABILITY_DIAG === '1') {
      console.log(
        JSON.stringify({
          type: 'availability_output_slots',
          requestId: getRequestId(),
          businessId,
          staffId,
          serviceId,
          date: dateStr.slice(0, 10),
          slots,
        }),
      );
    }

    return {
      slots,
      staffFirstName: fn,
      staffLastName: ln,
      _holdEngine: {
        workingStartMin: whStart,
        workingEndMin: whEnd,
        durationMinutes: duration,
        freeIntervalsAfterBusyMin: freeIntervalsAfterBusy,
      },
    };
  }

  private buildAvailabilityBottleneckSummary(p: {
    workingMinutes: number;
    freeMinutes: number;
    breakMinutes: number;
    bookedMinutes: number;
    duration: number;
    serviceDuration: number;
    bufferTime: number;
    totalCandidateSlots: number;
    slotsAfterBookingFilter: number;
    slotsAfterNonOverlapPack: number;
    validSlots: number;
    stepMinutes: number;
  }): string {
    const parts: string[] = [];
    if (p.workingMinutes > 0) {
      const brPct = (p.breakMinutes / p.workingMinutes) * 100;
      if (brPct > 15) {
        parts.push(
          `${brPct.toFixed(0)}% of declared working window removed by breaks/exceptions (${p.breakMinutes}min / ${p.workingMinutes}min)`,
        );
      }
    }
    if (p.freeMinutes > 0 && p.duration > 0) {
      parts.push(
        `freeAfterBreaks≈${p.freeMinutes}min, block=${p.duration}min (service ${p.serviceDuration} + buffers ${p.bufferTime}), step=${p.stepMinutes}min, ~${p.totalCandidateSlots} starts if no bookings`,
      );
    }
    if (p.bookedMinutes > 0) {
      parts.push(
        `bookings sum ~${p.bookedMinutes}min this local calendar day (subtracted before slot generation)`,
      );
    }
    if (p.totalCandidateSlots > 0 && p.slotsAfterBookingFilter < p.totalCandidateSlots * 0.3) {
      const lost = p.totalCandidateSlots - p.slotsAfterBookingFilter;
      parts.push(
        `bookings remove ~${lost}/${p.totalCandidateSlots} theoretical starts (${((lost / p.totalCandidateSlots) * 100).toFixed(0)}%)`,
      );
    }
    if (p.bufferTime >= 20) {
      parts.push(`buffers sum ${p.bufferTime}min — larger effective block`);
    }
    if (p.validSlots < p.slotsAfterNonOverlapPack) {
      parts.push(
        `AVAILABILITY_MAX_SLOTS_PER_HOUR reduced ${p.slotsAfterNonOverlapPack - p.validSlots} slots`,
      );
    }
    parts.push(`step=${p.stepMinutes}min`);
    return parts.join(' | ') || 'insufficient free time relative to effective duration';
  }

  private emitStructuredAvailabilityDiagnostics(payload: {
    type: string;
    businessId: string;
    staffId: string;
    serviceId: string;
    date: string;
    workingMinutes: number;
    bookedMinutes: number;
    freeMinutes: number;
    breakMinutes: number;
    serviceDuration: number;
    bufferTime: number;
    effectiveDurationMinutes: number;
    stepMinutes: number;
    totalCandidateSlots: number;
    slotsAfterBookingFilter: number;
    validSlots: number;
    slotsAfterNonOverlapPack: number;
    entropyScore: number;
    maxHourShare: number;
    hourDistribution: Record<string, number>;
    /** Always false — interval engine returns all valid starts (no greedy pack). */
    greedyPack: boolean;
    bottleneckSummary: string;
  }): void {
    const { validSlots, maxHourShare } = payload;
    if (validSlots >= 5 && maxHourShare <= 0.5) return;

    const line = JSON.stringify(payload);
    if (validSlots < 3) {
      this.logger.error(`AVAILABILITY_METRICS_CRITICAL ${line}`);
    } else {
      this.logger.warn(`AVAILABILITY_METRICS ${line}`);
    }
  }

  /**
   * Real-time dev aid: set LOG_AVAILABILITY_STAFF_SLOTS=1 (see .env.example).
   */
  private staffSlotsDevConsole(
    staffId: string,
    slotsLen: number,
    meta: {
      businessId: string;
      serviceId: string;
      dateStr: string;
      reason: string;
      dayOfWeekLocal?: number;
      durationMinutes?: number;
      appointmentsThatDay?: number;
    },
  ): void {
    if (this.config.get<string>('LOG_AVAILABILITY_STAFF_SLOTS') !== '1') return;
    console.log(`staff ${staffId} slots:`, slotsLen);
    if (slotsLen === 0) {
      console.warn('[availability] ZERO slots — check:', {
        ...meta,
        hints: [
          'שעות עבודה ליום זה (יום בשבוע מקומי)?',
          'חג / איסור בחגים?',
          'העובד משבץ חופשה?',
          'שירות מקושר לעובד + allowBooking?',
          'כל המקטע הפנוי בולע ע"י פגישות (כולל צעד grid/משך)?',
        ],
      });
    }
  }

  private validateAndLogOfferedSlots(ctx: {
    businessId: string;
    staffId: string;
    serviceId: string;
    dateStr: string;
    timeZone: string;
    dayStartUtcMs: number;
    workingStartMin: number;
    workingEndMin: number;
    durationMinutesForAvailability: number;
    /** Snapshot from `computeSlotStartsFromWorkingAndBusy` for parity logging (same ref as `freeIntervalsAfterBusyMin` when pipeline is correct). */
    generatedFree: MinuteInterval[];
    /** Same free half-open segments used to build offered starts (WH − full busy). */
    freeIntervalsAfterBusyMin: MinuteInterval[];
    slots: string[];
  }): void {
    const {
      businessId,
      staffId,
      serviceId,
      dateStr,
      timeZone,
      workingStartMin,
      workingEndMin,
      durationMinutesForAvailability,
      generatedFree,
      freeIntervalsAfterBusyMin,
      slots,
    } = ctx;

    const freeIntervalsUsedInValidator = freeIntervalsAfterBusyMin;
    if (this.config.get<string>('LOG_AVAILABILITY_FREE_INTERVAL_PARITY') === '1') {
      // Exact parity probe requested for debugging (compare objects + reference).
      // eslint-disable-next-line no-console -- intentional parity dump
      console.log({
        generatedFree,
        validationFree: freeIntervalsUsedInValidator,
        sameArrayReference: generatedFree === freeIntervalsUsedInValidator,
        sameValues:
          JSON.stringify(generatedFree) === JSON.stringify(freeIntervalsUsedInValidator),
      });
    }

    const minutesDebug =
      this.config.get<string>('LOG_AVAILABILITY_SLOT_MINUTES_DEBUG') === '1';

    if (minutesDebug) {
      this.logger.log(
        JSON.stringify({
          type: 'AVAILABILITY_SLOT_MINUTES_DEBUG',
          businessId,
          staffId,
          serviceId,
          dateStr,
          timeZone,
          workingStart: workingStartMin,
          workingEnd: workingEndMin,
          durationMin: durationMinutesForAvailability,
          workingStartMin,
          workingEndMin,
        }),
      );
    }

    const overlaps = findOfferedSlotOverlaps(dateStr, slots, durationMinutesForAvailability, {
      timeZone,
    });
    if (overlaps.length > 0 && this.config.get<string>('AVAILABILITY_STRICT_NO_OVERLAP') === '1') {
      this.logger.error(
        'AVAILABILITY_STRICT_NO_OVERLAP: overlapping offered windows',
        {
          businessId,
          staffId,
          serviceId,
          dateStr,
          durationMinutes: durationMinutesForAvailability,
          overlapsCount: overlaps.length,
        },
      );
      throw new InternalServerErrorException(
        'Availability invariant violated: offered slots overlap',
      );
    }

    const slotAnalysisOn =
      this.config.get<string>('LOG_AVAILABILITY_SLOT_ANALYSIS') === '1' ||
      this.config.get<string>('AVAILABILITY_DEBUG_SLOTS') === '1';

    if (slots.length === 0) return;

    for (const hhmm of slots) {
      const slotStart = Math.trunc(hhmmToMinutes(hhmm));
      const durEff = Math.max(1, Math.floor(Math.trunc(durationMinutesForAvailability)));
      const slotEnd = slotStart + durEff;
      // Same duration + same fit predicate as generateSlotStartsFromFreeIntervals / slotBlockFitsFreeInterval
      const inWh = isSlotBlockWithinWorkingMinutes(
        slotStart,
        durationMinutesForAvailability,
        workingStartMin,
        workingEndMin,
      );
      const inFree = slotBlockFitsAnyFreeSegment(
        slotStart,
        durationMinutesForAvailability,
        freeIntervalsAfterBusyMin,
      );
      const ok = inWh && inFree;
      if (minutesDebug) {
        this.logger.log(
          JSON.stringify({
            type: 'AVAILABILITY_SLOT_MINUTES_DEBUG_ROW',
            hhmm,
            slotStart,
            slotEnd,
            workingStart: workingStartMin,
            workingEnd: workingEndMin,
            slotStartMin: slotStart,
            slotEndMin: slotEnd,
            workingStartMin,
            workingEndMin,
            inWorkingWindow: inWh,
            inFreeInterval: inFree,
            valid: ok,
          }),
        );
      }
      if (!ok) {
        const failureReason = !inWh
          ? 'outside_working_window'
          : !inFree
            ? 'outside_free_interval'
            : 'unknown';
        this.logger.error(
          JSON.stringify({
            type: 'AVAILABILITY_OFFERED_SLOT_INVALID',
            message:
              'Offered slot failed numeric check (see failureReason: WH bounds vs free segments from computeSlotStartsFromWorkingAndBusy)',
            failureReason,
            hint:
              failureReason === 'outside_free_interval' && inWh
                ? 'NOT always "outside WH": block fits declared hours but no free segment contains [slotStart, slotEnd). Check busySubtractMin / Redis cache / breaks for this day.'
                : undefined,
            businessId,
            staffId,
            serviceId,
            dateStr,
            hhmm,
            slotStart,
            slotEnd,
            workingStart: workingStartMin,
            workingEnd: workingEndMin,
            slotStartMin: slotStart,
            slotEndMin: slotEnd,
            workingStartMin,
            workingEndMin,
            inWorkingWindow: inWh,
            inFreeInterval: inFree,
            freeIntervalsMin: freeIntervalsAfterBusyMin,
          }),
        );
      }
    }

    const report = buildSlotDistributionReport(slots);
    if (slotAnalysisOn) {
      const hist = formatSlotDistributionHistogram(report);
      this.logger.log(
        [
          `[availability-slot-analysis] businessId=${businessId} staffId=${staffId} serviceId=${serviceId} date=${dateStr} effectiveDurationMin=${durationMinutesForAvailability}`,
          `slotsCount=${report.slotsCount} uniqueHours=${report.uniqueHours} maxPerHour=${report.maxSlotsInOneHour} maxHourShare=${report.maxHourShare.toFixed(3)}`,
          'distribution:',
          hist,
        ].join('\n'),
      );
    }

  }
}

function sumMinuteIntervalLengths(intervals: MinuteInterval[]): number {
  return intervals.reduce((acc, b) => acc + Math.max(0, b.end - b.start), 0);
}

function filterAppointmentsForBusinessLocalDay(
  all: BookingSpan[],
  dateStr: string,
  timeZone: string,
): BookingSpan[] {
  const { startMs, endMs } = businessLocalDayBounds(timeZone, dateStr.slice(0, 10));
  return all.filter((a) => a.startTime.getTime() < endMs && a.endTime.getTime() > startMs);
}

function isDayBlockedByTimeOff(
  rows: Array<{
    isAllDay: boolean;
    startTime: string | null;
    endTime: string | null;
  }>,
): boolean {
  for (const t of rows) {
    if (t.isAllDay) return true;
    if (t.startTime && t.endTime) return true;
  }
  return false;
}
