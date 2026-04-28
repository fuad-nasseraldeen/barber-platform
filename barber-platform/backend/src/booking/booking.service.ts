import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ComputedAvailabilityService } from '../availability/computed-availability.service';
import type { GetAvailabilityHttpTiming } from '../availability/availability-http-timing.types';
import { NotificationService } from '../notifications/notification.service';
import { ArrivalConfirmationService } from '../notifications/arrival-confirmation.service';
import { AutomationService } from '../automation/automation.service';
import { CustomerVisitsService } from '../customer-visits/customer-visits.service';
import { BookAppointmentDto } from './dto/book-appointment.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { ConfirmBookingFromHoldDto } from './dto/confirm-booking-from-hold.dto';
import { CreateSlotHoldRequestDto } from './dto/create-slot-hold-request.dto';
import { ConvertWaitlistDto } from '../waitlist/dto/convert-waitlist.dto';
import {
  BOOKING_SLOT_CONFLICT_CODE,
  BOOKING_SLOT_CONFLICT_MESSAGE,
  HOLD_ALREADY_USED,
  HOLD_BUSINESS_MISMATCH,
  HOLD_EXPIRED,
  HOLD_FORBIDDEN,
  HOLD_NOT_FOUND,
  HOLD_SLOT_RACE_CODE,
  HOLD_SLOT_RACE_MESSAGE,
} from './booking-lock.errors';
import {
  BOOKING_PROJECTION_RESCHEDULE_EVENT_TYPE,
  RescheduleAppliedOutboxPayload,
} from './booking-projection-outbox.types';
import { SlotHoldService } from '../scheduling-v2/slot-hold.service';
import { TimeSlotService } from '../availability/time-slot.service';
import {
  AvailabilityHotCacheService,
  parseTimeSlotsDayBlob,
  TimeSlotsDayRedisBlob,
} from '../availability/availability-hot-cache.service';
import {
  AvailabilityOverlayEntry,
  AvailabilityOverlayService,
} from '../availability/availability-overlay.service';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import {
  BookingValidationService,
  ValidateBookingSlotResult,
} from './booking-validation.service';
import {
  getAppointmentCreateTraceEntries,
  getRequestContext,
  getLogContext,
  getPrismaMiddlewareQueryRecords,
  getPrismaQueryEventRecords,
  getPrismaQueryDurationMs,
  getRequestId,
  resetPrismaQueryDurationMs,
  setAppointmentCreateTraceInsideTransaction,
  setAppointmentCreateTracePhase,
  startAppointmentCreateTrace,
  stopAppointmentCreateTrace,
} from '../common/request-context';
import {
  ACCEPTABLE_MONITORING_RATES,
  BookingMetricsService,
} from './metrics.service';
import { AvailabilityMetricsService } from '../availability/availability-metrics.service';
import {
  CacheService,
  getAvailabilityRescheduleDirtyTtlSec,
  getAvailabilityTimeSlotsCacheTtlSec,
} from '../redis/cache.service';
import { enableRedis } from '../common/redis-config';
import { getBookingAtomicBookTxOptions } from '../common/prisma-serializable-tx-options';
import {
  addBusinessDaysFromYmd,
  businessLocalDayBounds,
  businessLocalDayOfWeek,
  formatInstantLocalHhmm,
  isCalendarDayHolidayInZone,
  resolveScheduleWallClockZone,
  resolveStaffWorkingHoursForBusinessLocalDay,
  type HolidayCheckRow,
  wallHhmmStringToMinuteOfDay,
} from '../common/business-local-time';
import {
  ensureValidBusinessZone,
  formatBusinessTime,
  getStartOfDay,
  parseBusinessWallSlotLocal,
  TimeEngineError,
} from '../common/time-engine';
import {
  getBusinessNow,
  parseIsoToUtcJsDate,
  utcNowJsDate,
  wallClockMs,
} from '../common/time';
import { DateTime } from 'luxon';
import {
  diversifySlotsForViewer,
  hhmmToMinutes,
  minutesToHhmm,
} from '../availability/simple-availability.engine';
import { getAvailabilitySlotStepMinutes } from '../common/availability-slot-interval';
import {
  getPrismaErrorDiagnostics,
  isBookingFinalConflictError,
  isPrismaExclusion23P01,
  isPrismaUniqueViolation,
  isPrismaUniqueViolationOnAppointmentSlotKey,
  isTransientInsertFailure,
} from '../common/prisma-error-helpers';

const EXPECTED_VALIDATION_CODES = [
  'NO_WORKING_HOURS',
  'STAFF_TIME_OFF',
  'OVERLAPS_BREAK',
  'OUTSIDE_WORKING_HOURS',
];

const SLOT_ATTEMPT_LOCK_TTL_SEC = 4;

function throwIfInvalid(result: ValidateBookingSlotResult, logger?: Logger): void {
  if (!result.valid) {
    const err = result.error;
    if (logger && !EXPECTED_VALIDATION_CODES.includes(err.code)) {
      const ctx = getLogContext();
      logger.warn(
        `[Booking] Validation failed: ${err.code} - ${err.message}`,
        { ...ctx, ...err.details },
      );
    }
    throw new BadRequestException(err.message);
  }
}

/**
 * Booking Core Stable v1
 * Frozen after correctness/performance validation.
 * Modify cautiously.
 */
export interface AvailabilitySlotUtcRow {
  /** UTC instant as ISO-8601 (Luxon). */
  startUtc: string;
  /** Wall clock start HH:mm in business timezone for that calendar day. */
  businessTime: string;
}

export interface AvailabilityResult {
  date: string;
  staffId: string;
  /** Omitted when `compact=1` on GET /availability. */
  staffName?: string;
  slots: string[];
  /** IANA zone used to compute these rows (business single source of truth). */
  businessTimezone?: string;
  /** Business wall clock “now” when the row was computed (HH:mm). */
  businessNow?: string;
  /** Same instant as ISO-8601 with offset in {@link businessTimezone}. */
  businessNowIso?: string;
  /** Per-slot UTC + wall metadata (omitted when `compact=1`). */
  slotsDetail?: AvailabilitySlotUtcRow[];
}

type DirtyWindow = { startMin: number; endMin: number };
type DirtyWindowsPayload = { v: 1; w: Array<[number, number]> };
type ReadRepairSpanSource = 'appointment' | 'slot_hold' | 'buffer';
type ReadRepairSpan = { startTime: Date; endTime: Date; source?: ReadRepairSpanSource };

type AppointmentCreateSlowQuery = {
  model: string;
  action: string;
  durationMs: number;
  sqlDurationMs?: number;
  sql?: string;
};

type AppointmentCreateRepeatedQuery = {
  fingerprint: string;
  count: number;
  totalMs: number;
};

type AppointmentCreateTimingState = {
  requestStartMs: number;
  requestEnteredMs: number;
  authMs: number;
  dtoValidationMs: number;
  customerLoadMs: number;
  staffLoadMs: number;
  serviceLoadMs: number;
  staffServiceValidationMs: number;
  slotHoldValidationMs: number;
  availabilityValidationMs: number;
  timeSlotUpdateMs: number;
  transactionMs: number;
  appointmentInsertMs: number;
  cacheInvalidationMs: number;
  projectionSyncMs: number;
  notificationMs: number;
  analyticsMs: number;
  responseBuildMs: number;
  serializationMs: number;
  holdLockMs: number;
  overlapCheckMs: number;
  slotHoldConsumeMs: number;
  commitMs: number;
  txTotalMs: number;
  projectionRegeneratedDuringCreate: boolean;
  notificationsAwaitedInsideCreate: boolean;
  invalidatedKeyCount: number;
  invalidationPatterns: string[];
  staffId?: string;
  serviceId?: string;
  customerId?: string;
};

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  private static readonly appointmentInsertSelect = {
    id: true,
    businessId: true,
    branchId: true,
    locationId: true,
    customerId: true,
    staffId: true,
    serviceId: true,
    startTime: true,
    endTime: true,
    status: true,
    slotKey: true,
    notes: true,
    slotHoldId: true,
    idempotencyKey: true,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly computedAvailability: ComputedAvailabilityService,
    private readonly validation: BookingValidationService,
    private readonly notifications: NotificationService,
    private readonly arrivalConfirmation: ArrivalConfirmationService,
    private readonly customerVisits: CustomerVisitsService,
    private readonly automation: AutomationService,
    private readonly metrics: BookingMetricsService,
    private readonly availabilityMetrics: AvailabilityMetricsService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
    private readonly slotHolds: SlotHoldService,
    private readonly timeSlots: TimeSlotService,
    private readonly hotAvailabilityCache: AvailabilityHotCacheService,
    private readonly availabilityOverlay: AvailabilityOverlayService,
  ) {}

  private get useTimeSlots(): boolean {
    return this.config.get<string>('USE_TIME_SLOTS') === '1';
  }

  /** Redis cache-aside for `getAvailabilityFromTimeSlots` (requires ENABLE_REDIS=true). */
  private get availabilityTimeSlotsRedisCacheOn(): boolean {
    return (
      enableRedis && this.config.get<string>('AVAILABILITY_REDIS_CACHE') === '1'
    );
  }

  private get rescheduleDirtyDayTtlSec(): number {
    return getAvailabilityRescheduleDirtyTtlSec();
  }

  private readonly tzCache = new Map<string, { tz: string; expiresAt: number }>();
  private static readonly TZ_CACHE_MS = 3_600_000; // 1 hour

  async getBusinessTimezone(businessId: string): Promise<{ timezone: string }> {
    const cached = this.tzCache.get(businessId);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.log(
        JSON.stringify({
          type: 'BUSINESS_TZ_CACHE',
          cache: 'hit',
          businessId,
          requestId: getRequestId(),
        }),
      );
      return { timezone: cached.tz };
    }
    const biz = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    const tz = ensureValidBusinessZone(resolveScheduleWallClockZone(biz?.timezone));
    this.tzCache.set(businessId, { tz, expiresAt: Date.now() + BookingService.TZ_CACHE_MS });
    this.logger.log(
      JSON.stringify({
        type: 'BUSINESS_TZ_CACHE',
        cache: 'miss',
        businessId,
        requestId: getRequestId(),
      }),
    );
    return { timezone: tz };
  }

  /**
   * Get booking metrics for observability (per tenant).
   */
  getMetrics(tenantId?: string) {
    return this.metrics.getMetrics(tenantId);
  }

  private createAvailabilityTimingCollector(): GetAvailabilityHttpTiming {
    return {
      populated: false,
      dayMap: {
        path: '',
        totalMs: 0,
        redisMs: 0,
        redisCallCount: 0,
        payloadSizeBytes: 0,
        keysPerRequest: 0,
        dbMs: 0,
        busyPrepMs: 0,
        computeMs: 0,
      },
      envelope: {
        totalMs: 0,
        bookingBusinessTzMs: 0,
        dayMapCallMs: 0,
        bookingAfterDayMapMs: 0,
      },
    };
  }

  private emitFlowTiming(payload: {
    step: 'hold' | 'book' | 'availability';
    validationMs?: number;
    dbMs?: number;
    redisMs?: number;
    redisCallCount?: number;
    payloadSizeBytes?: number;
    keysPerRequest?: number;
    dbQueryCount?: number;
    slowDbQueryCount?: number;
    computeMs?: number;
    totalMs: number;
  }): void {
    const out: Record<string, number | string> = {
      step: payload.step,
      totalMs: Math.round(payload.totalMs),
    };
    if (payload.validationMs != null) {
      out.validationMs = Math.round(payload.validationMs);
    }
    if (payload.dbMs != null) {
      out.dbMs = Math.round(payload.dbMs);
    }
    if (payload.redisMs != null) {
      out.redisMs = Math.round(payload.redisMs);
    }
    if (payload.redisCallCount != null) {
      out.redisCallCount = Math.round(payload.redisCallCount);
    }
    if (payload.payloadSizeBytes != null) {
      out.payloadSizeBytes = Math.round(payload.payloadSizeBytes);
    }
    if (payload.keysPerRequest != null) {
      out.keysPerRequest = Math.round(payload.keysPerRequest);
    }
    if (payload.dbQueryCount != null) {
      out.dbQueryCount = Math.round(payload.dbQueryCount);
    }
    if (payload.slowDbQueryCount != null) {
      out.slowDbQueryCount = Math.round(payload.slowDbQueryCount);
    }
    if (payload.computeMs != null) {
      out.computeMs = Math.round(payload.computeMs);
    }
    console.log(JSON.stringify(out));
  }

  private emitWritePathStageProfile(payload: {
    flow: 'slot_hold' | 'booking' | 'reschedule';
    operation: string;
    businessId: string;
    statusCode: number;
    resultType: 'success' | 'conflict' | 'error';
    validationMs?: number;
    dbMs?: number;
    transactionMs?: number;
    totalMs: number;
    holdId?: string;
    appointmentId?: string;
    staffId?: string;
    serviceId?: string;
    conflictCode?: string;
    errorCode?: string;
  }): void {
    const shouldLog =
      payload.flow === 'reschedule'
        ? this.shouldLogReschedulePerf()
        : this.shouldLogBookingPerfPhases();
    if (!shouldLog) return;
    try {
      console.log(
        JSON.stringify({
          type: 'WRITE_PATH_STAGE_PROFILE',
          flow: payload.flow,
          operation: payload.operation,
          businessId: payload.businessId,
          statusCode: payload.statusCode,
          resultType: payload.resultType,
          validation_ms:
            payload.validationMs != null
              ? Math.round(payload.validationMs)
              : undefined,
          db_ms: payload.dbMs != null ? Math.round(payload.dbMs) : undefined,
          transaction_ms:
            payload.transactionMs != null
              ? Math.round(payload.transactionMs)
              : undefined,
          total_ms: Math.round(payload.totalMs),
          holdId: payload.holdId,
          appointmentId: payload.appointmentId,
          staffId: payload.staffId,
          serviceId: payload.serviceId,
          conflictCode: payload.conflictCode,
          errorCode: payload.errorCode,
        }),
      );
    } catch {
      /* ignore profiling log failures */
    }
  }

  private shouldMeasureSerialization(): boolean {
    return this.shouldLogBookingPerfPhases();
  }

  private createAppointmentCreateTimingState(): AppointmentCreateTimingState {
    const requestStartMs = getRequestContext()?.requestStartMs ?? Date.now();
    const requestEnteredMs = wallClockMs();
    return {
      requestStartMs,
      requestEnteredMs,
      authMs: Math.max(0, requestEnteredMs - requestStartMs),
      dtoValidationMs: 0,
      customerLoadMs: 0,
      staffLoadMs: 0,
      serviceLoadMs: 0,
      staffServiceValidationMs: 0,
      slotHoldValidationMs: 0,
      availabilityValidationMs: 0,
      timeSlotUpdateMs: 0,
      transactionMs: 0,
      appointmentInsertMs: 0,
      cacheInvalidationMs: 0,
      projectionSyncMs: 0,
      notificationMs: 0,
      analyticsMs: 0,
      responseBuildMs: 0,
      serializationMs: 0,
      holdLockMs: 0,
      overlapCheckMs: 0,
      slotHoldConsumeMs: 0,
      commitMs: 0,
      txTotalMs: 0,
      projectionRegeneratedDuringCreate: false,
      notificationsAwaitedInsideCreate: false,
      invalidatedKeyCount: 0,
      invalidationPatterns: [],
    };
  }

  private buildCreatePrismaDiagnostics(): {
    prismaQueryCount: number;
    prismaTotalMs: number;
    slowQueries: AppointmentCreateSlowQuery[];
    repeatedQueries: AppointmentCreateRepeatedQuery[];
    projectionRegeneratedDuringCreate: boolean;
  } {
    const prismaQueries = getPrismaMiddlewareQueryRecords();
    const prismaQueryEvents = getPrismaQueryEventRecords();
    const prismaTotalMs = getPrismaQueryDurationMs() ?? 0;
    const combined = prismaQueries.map((q, i) => {
      const event = prismaQueryEvents[i];
      const sql = event?.sql ?? '';
      const sqlSnippet = sql.length > 300 ? `${sql.slice(0, 300)}…` : sql;
      return {
        model: q.model,
        action: q.action,
        durationMs: q.durationMs,
        sqlDurationMs: event?.durationMs,
        sql: sqlSnippet,
      };
    });

    const slowQueries = combined
      .filter((q) => q.durationMs >= 80 || (q.sqlDurationMs ?? 0) >= 80)
      .sort((a, b) => Math.max(b.durationMs, b.sqlDurationMs ?? 0) - Math.max(a.durationMs, a.sqlDurationMs ?? 0))
      .slice(0, 12);

    const repeatedMap = new Map<string, { count: number; totalMs: number }>();
    for (const q of combined) {
      const fingerprint = `${q.model}.${q.action}:${q.sql ?? ''}`;
      const curr = repeatedMap.get(fingerprint) ?? { count: 0, totalMs: 0 };
      curr.count += 1;
      curr.totalMs += q.durationMs;
      repeatedMap.set(fingerprint, curr);
    }
    const repeatedQueries = Array.from(repeatedMap.entries())
      .filter(([, v]) => v.count > 1)
      .map(([fingerprint, v]) => ({
        fingerprint: fingerprint.length > 220 ? `${fingerprint.slice(0, 220)}…` : fingerprint,
        count: v.count,
        totalMs: Math.round(v.totalMs),
      }))
      .sort((a, b) => b.count - a.count || b.totalMs - a.totalMs)
      .slice(0, 12);

    const projectionRegeneratedDuringCreate = combined.some((q) => {
      const sql = (q.sql ?? '').toLowerCase();
      if (!sql) return false;
      return (
        (sql.includes('time_slots') && sql.includes('insert into')) ||
        (sql.includes('time_slots') && sql.includes('delete from')) ||
        sql.includes('regenerate')
      );
    });

    return {
      prismaQueryCount: combined.length,
      prismaTotalMs: Math.round(prismaTotalMs),
      slowQueries,
      repeatedQueries,
      projectionRegeneratedDuringCreate,
    };
  }

  private async sampleDbWaitDiagnostics(): Promise<{
    capturedAtIso: string;
    active: Array<{
      pid: number;
      state: string | null;
      waitEventType: string | null;
      waitEvent: string | null;
      queryStart: string | null;
      runningFor: string | null;
      blockingPids: number[];
      queryPreview: string | null;
    }>;
  }> {
    const rows = await this.prisma.$queryRaw<Array<{
      pid: number;
      state: string | null;
      waitEventType: string | null;
      waitEvent: string | null;
      queryStart: Date | null;
      runningFor: unknown;
      blockingPids: number[] | null;
      queryPreview: string | null;
    }>>`
      SELECT
        a.pid,
        a.state,
        a.wait_event_type AS "waitEventType",
        a.wait_event AS "waitEvent",
        a.query_start AS "queryStart",
        now() - a.query_start AS "runningFor",
        pg_blocking_pids(a.pid) AS "blockingPids",
        left(a.query, 300) AS "queryPreview"
      FROM pg_stat_activity a
      WHERE a.datname = current_database()
        AND a.pid <> pg_backend_pid()
        AND a.state IS DISTINCT FROM 'idle'
      ORDER BY a.query_start ASC
      LIMIT 30
    `;
    return {
      capturedAtIso: new Date().toISOString(),
      active: rows.map((row) => ({
        pid: row.pid,
        state: row.state,
        waitEventType: row.waitEventType,
        waitEvent: row.waitEvent,
        queryStart: row.queryStart ? row.queryStart.toISOString() : null,
        runningFor: row.runningFor != null ? String(row.runningFor) : null,
        blockingPids: row.blockingPids ?? [],
        queryPreview: row.queryPreview,
      })),
    };
  }

  private shouldLogReschedulePerf(): boolean {
    return (
      process.env.LOG_RESCHEDULE_PERF === '1' ||
      process.env.BOOKING_PERF_LOG === '1'
    );
  }

  private shouldLogRescheduleDebug(): boolean {
    return process.env.RESCHEDULE_DEBUG === '1';
  }

  private logRescheduleDebug(payload: Record<string, unknown>): void {
    if (!this.shouldLogRescheduleDebug()) return;
    this.logger.log(
      JSON.stringify({
        type: 'RESCHEDULE_DEBUG',
        requestId: getRequestId(),
        ...payload,
      }),
    );
  }

  private logRescheduleSlotSync(payload: Record<string, unknown>): void {
    this.logger.log(JSON.stringify(payload));
  }

  private async loadTimeSlotRowsForWallRange(params: {
    staffId: string;
    dateYmd: string;
    startHhmm: string;
    endHhmm: string;
  }): Promise<
    Array<{
      startTime: string;
      status: string;
      appointmentId: string | null;
      holdId: string | null;
    }>
  > {
    if (!this.useTimeSlots) return [];
    if (hhmmToMinutes(params.endHhmm) <= hhmmToMinutes(params.startHhmm)) return [];
    const rows = await this.prisma.timeSlot.findMany({
      where: {
        staffId: params.staffId,
        date: new Date(params.dateYmd.slice(0, 10)),
        startTime: {
          gte: params.startHhmm,
          lt: params.endHhmm,
        },
      },
      select: {
        startTime: true,
        status: true,
        appointmentId: true,
        holdId: true,
      },
      orderBy: { startTime: 'asc' },
    });
    return rows.map((row) => ({
      startTime: row.startTime,
      status: row.status,
      appointmentId: row.appointmentId,
      holdId: row.holdId,
    }));
  }

  private measureSerializationMs(payload: unknown): number {
    if (!this.shouldMeasureSerialization()) return 0;
    const t0 = wallClockMs();
    try {
      JSON.stringify(payload);
    } catch {
      /* ignore serialization timing failures */
    }
    return wallClockMs() - t0;
  }

  private shouldLogBookingPerfPhases(): boolean {
    return (
      process.env.LOG_SLOT_HOLD_PERF === '1' ||
      process.env.LOG_BOOKING_CONFIRM_PERF === '1' ||
      process.env.LOG_AVAILABILITY_INTERNAL_TIMING === '1'
    );
  }

  private emitPerfPhase(payload: {
    event:
      | 'AVAILABILITY_PHASE'
      | 'HOLD_PHASE'
      | 'BOOK_PHASE'
      | 'RESCHEDULE_PHASE'
      | 'CANCEL_PHASE';
    requestType: 'availability' | 'hold' | 'book' | 'reschedule' | 'cancel';
    phase: string;
    phaseMs: number;
    totalMs: number;
    businessId?: string;
    staffId?: string;
    bookingId?: string;
    appointmentId?: string;
    holdId?: string;
    serviceId?: string;
    date?: string;
    slotTime?: string;
    cacheHit?: boolean;
    cacheKey?: string;
    scenario?: string;
    operation?: string;
    statusCode?: number;
    resultType?: 'success' | 'conflict' | 'error';
    conflictCode?: string;
    errorCode?: string;
    outcome?: string;
  }): void {
    if (!this.shouldLogBookingPerfPhases()) return;
    try {
      console.log(
        JSON.stringify({
          event: payload.event,
          requestType: payload.requestType,
          operation: payload.operation,
          phase: payload.phase,
          durationMs: Math.round(payload.phaseMs),
          totalDurationMs: Math.round(payload.totalMs),
          businessId: payload.businessId,
          staffId: payload.staffId,
          bookingId: payload.bookingId,
          appointmentId: payload.appointmentId ?? payload.bookingId,
          holdId: payload.holdId,
          serviceId: payload.serviceId,
          date: payload.date,
          slotTime: payload.slotTime,
          cacheHit: payload.cacheHit,
          cacheKey: payload.cacheKey,
          scenario: payload.scenario,
          statusCode: payload.statusCode,
          resultType: payload.resultType,
          conflictCode: payload.conflictCode,
          errorCode: payload.errorCode,
          outcome: payload.outcome,
        }),
      );
    } catch {
      /* ignore */
    }
  }

  private filterSlotsByOverlay(
    slots: string[],
    blockMinutes: number,
    overlay: AvailabilityOverlayEntry[],
  ): string[] {
    if (slots.length === 0 || overlay.length === 0) return slots;
    const duration = Math.max(1, blockMinutes);
    return slots.filter((hhmm) => {
      const startMin = hhmmToMinutes(hhmm);
      const endMin = startMin + duration;
      return !overlay.some(
        (entry) => startMin < entry.endMin && endMin > entry.startMin,
      );
    });
  }

  private estimatePayloadSizeBytes(input: unknown): number {
    if (input == null) return 0;
    try {
      return Buffer.byteLength(JSON.stringify(input), 'utf8');
    } catch {
      return 0;
    }
  }

  /**
   * Dirty-day narrow fallback:
   * - keep `time_slots` projection fast-path for clean days
   * - for dirty day only, patch projected free cells against DB-truth occupied intervals
   *   (appointments + active holds), scoped to one staff + one business-local day.
   */
  private async applyDirtyDayNarrowFallback(params: {
    businessId: string;
    staffId: string;
    dateYmd: string;
    businessTimeZone: string;
    blockMinutes: number;
    projectedStarts: string[];
    windows: DirtyWindow[];
  }): Promise<string[]> {
    if (params.windows.length === 0) {
      return [...params.projectedStarts].sort(
        (a, b) => hhmmToMinutes(a) - hhmmToMinutes(b),
      );
    }
    const stepMinutes = Math.max(1, getAvailabilitySlotStepMinutes(this.config));
    const blockMinutes = Math.max(1, params.blockMinutes);
    const dayStart = DateTime.fromISO(params.dateYmd, {
      zone: params.businessTimeZone,
    }).startOf('day');
    const expandedWindows = this.expandWindowsForStartTimes(
      params.windows,
      blockMinutes,
      stepMinutes,
    );
    const minStart = expandedWindows.reduce((min, w) => Math.min(min, w.startMin), 1440);
    const maxEnd = expandedWindows.reduce((max, w) => Math.max(max, w.endMin), 0);
    if (maxEnd <= minStart) {
      return [...params.projectedStarts].sort(
        (a, b) => hhmmToMinutes(a) - hhmmToMinutes(b),
      );
    }
    const windowStartUtc = dayStart.plus({ minutes: minStart }).toUTC().toJSDate();
    const windowEndUtc = dayStart.plus({ minutes: maxEnd }).toUTC().toJSDate();
    const nowUtc = utcNowJsDate();

    const [windowSlots, appointments, activeHolds] = await Promise.all([
      this.prisma.timeSlot.findMany({
        where: {
          businessId: params.businessId,
          staffId: params.staffId,
          date: new Date(params.dateYmd),
          startTime: {
            gte: minutesToHhmm(minStart),
            lt: minutesToHhmm(maxEnd),
          },
        },
        select: { startTime: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          businessId: params.businessId,
          staffId: params.staffId,
          status: { not: AppointmentStatus.CANCELLED },
          startTime: { lt: windowEndUtc },
          endTime: { gt: windowStartUtc },
        },
        select: { startTime: true, endTime: true },
      }),
      this.prisma.slotHold.findMany({
        where: {
          businessId: params.businessId,
          staffId: params.staffId,
          consumedAt: null,
          expiresAt: { gt: nowUtc },
          startTime: { lt: windowEndUtc },
          endTime: { gt: windowStartUtc },
        },
        select: { startTime: true, endTime: true },
      }),
    ]);

    if (windowSlots.length === 0) {
      return [...params.projectedStarts].sort(
        (a, b) => hhmmToMinutes(a) - hhmmToMinutes(b),
      );
    }

    const occupiedRanges: Array<{ startMin: number; endMin: number }> = [];
    for (const interval of [...appointments, ...activeHolds]) {
      const range = this.intervalToBusinessDayRange({
        start: interval.startTime,
        end: interval.endTime,
        dateYmd: params.dateYmd,
        businessTimeZone: params.businessTimeZone,
      });
      if (range) occupiedRanges.push(range);
    }

    const candidateStarts = windowSlots
      .map((slot) => slot.startTime)
      .filter((hhmm) => {
        const startMin = hhmmToMinutes(hhmm);
        const endMin = startMin + blockMinutes;
        return expandedWindows.some(
          (window) => startMin < window.endMin && endMin > window.startMin,
        );
      });

    const patchedStarts = new Set<string>(params.projectedStarts);
    for (const hhmm of candidateStarts) {
      const startMin = hhmmToMinutes(hhmm);
      const endMin = startMin + blockMinutes;
      const occupied = occupiedRanges.some(
        (range) => startMin < range.endMin && endMin > range.startMin,
      );
      if (occupied) patchedStarts.delete(hhmm);
      else patchedStarts.add(hhmm);
    }

    return [...patchedStarts].sort((a, b) => hhmmToMinutes(a) - hhmmToMinutes(b));
  }

  private expandWindowsForStartTimes(
    windows: DirtyWindow[],
    blockMinutes: number,
    stepMinutes: number,
  ): DirtyWindow[] {
    const lookback = Math.max(0, blockMinutes - stepMinutes);
    return this.mergeAndClampDirtyWindows(
      windows.map((window) => ({
        startMin: window.startMin - lookback,
        endMin: window.endMin,
      })),
    );
  }

  private parseDirtyWindowsPayload(raw: unknown): DirtyWindow[] {
    if (!raw || typeof raw !== 'object') return [];
    const payload = raw as Partial<DirtyWindowsPayload>;
    if (payload.v !== 1 || !Array.isArray(payload.w)) return [];
    return this.mergeAndClampDirtyWindows(
      payload.w
        .map((entry) =>
          Array.isArray(entry) && entry.length === 2
            ? { startMin: Number(entry[0]), endMin: Number(entry[1]) }
            : null,
        )
        .filter((entry): entry is DirtyWindow => entry != null),
    );
  }

  private mergeAndClampDirtyWindows(windows: DirtyWindow[]): DirtyWindow[] {
    const normalized = windows
      .map((window) => ({
        startMin: Math.max(0, Math.min(1439, Math.floor(window.startMin))),
        endMin: Math.max(0, Math.min(1440, Math.ceil(window.endMin))),
      }))
      .filter((window) => Number.isFinite(window.startMin) && Number.isFinite(window.endMin))
      .filter((window) => window.endMin > window.startMin)
      .sort((a, b) => a.startMin - b.startMin);
    if (normalized.length <= 1) return normalized;
    const merged: DirtyWindow[] = [normalized[0]];
    for (let i = 1; i < normalized.length; i++) {
      const current = normalized[i];
      const last = merged[merged.length - 1];
      if (current.startMin <= last.endMin) {
        last.endMin = Math.max(last.endMin, current.endMin);
      } else {
        merged.push(current);
      }
    }
    return merged;
  }

  private toDirtyWindowsPayload(windows: DirtyWindow[]): DirtyWindowsPayload {
    return {
      v: 1,
      w: windows.map((window) => [window.startMin, window.endMin]),
    };
  }

  private async markDirtyWindows(params: {
    businessId: string;
    windows: Array<{ staffId: string; dateYmd: string; startMin: number; endMin: number }>;
  }): Promise<void> {
    if (params.windows.length === 0) return;
    const grouped = new Map<
      string,
      { staffId: string; dateYmd: string; windows: DirtyWindow[] }
    >();
    for (const window of params.windows) {
      const dateYmd = window.dateYmd.slice(0, 10);
      const key = `${window.staffId}:${dateYmd}`;
      const bucket = grouped.get(key) ?? {
        staffId: window.staffId,
        dateYmd,
        windows: [],
      };
      bucket.windows.push({ startMin: window.startMin, endMin: window.endMin });
      grouped.set(key, bucket);
    }
    const ttlSec = this.rescheduleDirtyDayTtlSec;
    await Promise.all(
      [...grouped.values()].map(async (group) => {
        const key = CacheService.keys.availabilityRescheduleDirtyWindows(
          params.businessId,
          group.staffId,
          group.dateYmd,
        );
        const current = this.parseDirtyWindowsPayload(await this.cache.get<unknown>(key));
        const merged = this.mergeAndClampDirtyWindows([...current, ...group.windows]);
        await this.cache.set(key, this.toDirtyWindowsPayload(merged), ttlSec);
      }),
    );
  }

  private intervalToBusinessDayRange(params: {
    start: Date;
    end: Date;
    dateYmd: string;
    businessTimeZone: string;
  }): { startMin: number; endMin: number } | null {
    const dayStart = DateTime.fromISO(params.dateYmd, {
      zone: params.businessTimeZone,
    }).startOf('day');
    const dayEnd = dayStart.plus({ days: 1 });

    const clippedStartMs = Math.max(
      dayStart.toUTC().toMillis(),
      params.start.getTime(),
    );
    const clippedEndMs = Math.min(dayEnd.toUTC().toMillis(), params.end.getTime());
    if (clippedEndMs <= clippedStartMs) return null;

    const localStart = DateTime.fromMillis(clippedStartMs, { zone: 'utc' }).setZone(
      params.businessTimeZone,
    );
    const localEnd = DateTime.fromMillis(clippedEndMs, { zone: 'utc' }).setZone(
      params.businessTimeZone,
    );
    const startMin = localStart.hour * 60 + localStart.minute;
    let endMin = localEnd.hour * 60 + localEnd.minute;
    if (clippedEndMs === dayEnd.toUTC().toMillis()) endMin = 1440;
    return {
      startMin: Math.max(0, Math.min(1439, startMin)),
      endMin: Math.max(0, Math.min(1440, endMin)),
    };
  }

  private shouldRunAvailabilityEmptyDebug(
    query: AvailabilityQueryDto,
    results: AvailabilityResult[],
  ): boolean {
    if (this.config.get<string>('AVAILABILITY_EMPTY_DEBUG') !== '1') return false;
    const targetDate =
      this.config.get<string>('AVAILABILITY_EMPTY_DEBUG_DATE') ?? '2026-04-26';
    const targetStaffId =
      this.config.get<string>('AVAILABILITY_EMPTY_DEBUG_STAFF_ID') ??
      'a0000001-0000-4000-8000-000000000003';
    const targetBusinessId =
      this.config.get<string>('AVAILABILITY_EMPTY_DEBUG_BUSINESS_ID')?.trim() ??
      '';
    const targetServiceId =
      this.config.get<string>('AVAILABILITY_EMPTY_DEBUG_SERVICE_ID')?.trim() ??
      '';

    const requestDate = query.date.slice(0, 10);
    if (requestDate !== targetDate) return false;
    if (query.staffId !== targetStaffId) return false;
    if (targetBusinessId && query.businessId !== targetBusinessId) return false;
    if (targetServiceId && query.serviceId !== targetServiceId) return false;

    const dayRow = results.find((r) => r.date === requestDate) ?? results[0];
    return (dayRow?.slots?.length ?? 0) === 0;
  }

  private async maybeEmitAvailabilityEmptyDebugResult(input: {
    query: AvailabilityQueryDto;
    results: AvailabilityResult[];
    readPath: 'time_slots' | 'computed';
  }): Promise<void> {
    if (!this.shouldRunAvailabilityEmptyDebug(input.query, input.results)) return;

    const ymd = input.query.date.slice(0, 10);
    const stepMinutes = Math.max(1, getAvailabilitySlotStepMinutes(this.config));
    const bookingWindowDays = Math.max(
      0,
      parseInt(this.config.get<string>('BOOKING_WINDOW_DAYS', '90'), 10) || 90,
    );

    const { timezone } = await this.getBusinessTimezone(input.query.businessId);
    const businessNow = getBusinessNow(timezone);
    const businessNowHhmm = businessNow.toFormat('HH:mm');
    const businessNowIso =
      businessNow.toISO({ includeOffset: true }) ?? businessNow.toString();
    const bookingWindowStart = businessNow.toISODate() ?? ymd;
    const bookingWindowEnd =
      businessNow.plus({ days: bookingWindowDays }).toISODate() ?? ymd;
    const isDateInsideBookingWindow = this.computedAvailability.isWithinBookingWindow(
      ymd,
      timezone,
    );

    const { startMs: dayStartMs, endMs: dayEndMsExclusive } = businessLocalDayBounds(
      timezone,
      ymd,
    );
    const dayStart = new Date(dayStartMs);
    const dayEndExclusive = new Date(dayEndMsExclusive);
    const nowUtc = utcNowJsDate();
    const dayOfWeek = businessLocalDayOfWeek(timezone, ymd);

    const [
      staffRaw,
      serviceRaw,
      staffServiceRaw,
      weeklyWorkingHoursRaw,
      workingHoursOverrideRaw,
      weeklyBreaksRaw,
      breakExceptionsRaw,
      timeOffRaw,
      holidaysRaw,
      appointmentsRaw,
      activeHoldsRaw,
      timeSlotsRowsRaw,
    ] = await Promise.all([
      this.prisma.staff.findFirst({
        where: { id: input.query.staffId, businessId: input.query.businessId },
        select: { id: true, isActive: true, deletedAt: true },
      }),
      this.prisma.service.findFirst({
        where: { id: input.query.serviceId, businessId: input.query.businessId },
        select: {
          id: true,
          isActive: true,
          deletedAt: true,
          durationMinutes: true,
          bufferBeforeMinutes: true,
          bufferAfterMinutes: true,
        },
      }),
      this.prisma.staffService.findFirst({
        where: {
          staffId: input.query.staffId,
          serviceId: input.query.serviceId,
          allowBooking: true,
        },
        select: {
          durationMinutes: true,
          allowBooking: true,
          service: {
            select: {
              durationMinutes: true,
              bufferBeforeMinutes: true,
              bufferAfterMinutes: true,
              deletedAt: true,
              isActive: true,
            },
          },
        },
      }),
      this.prisma.staffWorkingHours.findMany({
        where: { staffId: input.query.staffId, dayOfWeek },
        select: { dayOfWeek: true, startTime: true, endTime: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.staffWorkingHoursDateOverride.findMany({
        where: {
          staffId: input.query.staffId,
          date: { gte: dayStart, lt: dayEndExclusive },
        },
        select: { date: true, isClosed: true, startTime: true, endTime: true },
      }),
      this.prisma.staffBreak.findMany({
        where: { staffId: input.query.staffId, dayOfWeek },
        select: { startTime: true, endTime: true },
      }),
      this.prisma.staffBreakException.findMany({
        where: {
          staffId: input.query.staffId,
          date: { gte: dayStart, lt: dayEndExclusive },
        },
        select: { startTime: true, endTime: true, kind: true },
      }),
      this.prisma.staffTimeOff.findMany({
        where: {
          staffId: input.query.staffId,
          status: 'APPROVED',
          startDate: { lt: dayEndExclusive },
          endDate: { gte: dayStart },
        },
        select: {
          startDate: true,
          endDate: true,
          startTime: true,
          endTime: true,
          isAllDay: true,
          status: true,
        },
      }),
      this.prisma.businessHoliday.findMany({
        where: {
          businessId: input.query.businessId,
          OR: [
            { isRecurring: false, date: { gte: dayStart, lt: dayEndExclusive } },
            { isRecurring: true },
          ],
        },
        select: { date: true, isRecurring: true, name: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          businessId: input.query.businessId,
          staffId: input.query.staffId,
          status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
          startTime: { lt: dayEndExclusive },
          endTime: { gt: dayStart },
        },
        select: { id: true, startTime: true, endTime: true, status: true },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.slotHold.findMany({
        where: {
          businessId: input.query.businessId,
          staffId: input.query.staffId,
          consumedAt: null,
          expiresAt: { gt: nowUtc },
          startTime: { lt: dayEndExclusive },
          endTime: { gt: dayStart },
        },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          expiresAt: true,
          consumedAt: true,
        },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.timeSlot.findMany({
        where: {
          businessId: input.query.businessId,
          staffId: input.query.staffId,
          date: new Date(ymd),
        },
        select: {
          id: true,
          startTime: true,
          endMin: true,
          durationMinutes: true,
          status: true,
          holdId: true,
          appointmentId: true,
        },
        orderBy: { startTime: 'asc' },
      }),
    ]);

    const staffExists = Boolean(staffRaw);
    const staffIsActive = Boolean(
      staffRaw && staffRaw.isActive && staffRaw.deletedAt == null,
    );
    const serviceExists = Boolean(serviceRaw);
    const serviceIsActive = Boolean(
      serviceRaw && serviceRaw.isActive && serviceRaw.deletedAt == null,
    );

    const serviceDuration =
      serviceRaw?.durationMinutes != null
        ? Math.max(1, serviceRaw.durationMinutes)
        : null;
    const serviceBufferBefore = serviceRaw?.bufferBeforeMinutes ?? 0;
    const serviceBufferAfter = serviceRaw?.bufferAfterMinutes ?? 0;
    const serviceAssigned = Boolean(
      staffServiceRaw &&
        staffServiceRaw.allowBooking &&
        staffServiceRaw.service.deletedAt == null &&
        staffServiceRaw.service.isActive,
    );

    const staffServiceDuration =
      staffServiceRaw == null
        ? null
        : Math.max(
            1,
            staffServiceRaw.durationMinutes > 0
              ? staffServiceRaw.durationMinutes
              : staffServiceRaw.service.durationMinutes,
          );
    const effectiveBlockMinutes =
      staffServiceDuration == null
        ? null
        : Math.max(
            1,
            staffServiceDuration +
              (staffServiceRaw?.service.bufferBeforeMinutes ?? 0) +
              (staffServiceRaw?.service.bufferAfterMinutes ?? 0),
          );

    const workingHoursResolved = resolveStaffWorkingHoursForBusinessLocalDay({
      ymd,
      timeZone: timezone,
      weeklyRows: weeklyWorkingHoursRaw,
      dateOverrides: workingHoursOverrideRaw,
    });
    const activeOverride = workingHoursOverrideRaw[0] ?? null;
    const workingHoursSource = activeOverride
      ? activeOverride.isClosed
        ? 'date_override_closed'
        : activeOverride.startTime && activeOverride.endTime
          ? 'date_override_open'
          : 'date_override_invalid_fallback_or_none'
      : weeklyWorkingHoursRaw.length > 0
        ? 'weekly'
        : 'none';
    const isClosedByOverride = activeOverride?.isClosed === true;

    const holidaysForCheck = holidaysRaw as HolidayCheckRow[];
    const isHoliday = isCalendarDayHolidayInZone(ymd, holidaysForCheck, timezone);

    const appointmentRanges = appointmentsRaw
      .map((a) =>
        this.intervalToBusinessDayRange({
          start: a.startTime,
          end: a.endTime,
          dateYmd: ymd,
          businessTimeZone: timezone,
        }),
      )
      .filter(
        (
          r,
        ): r is {
          startMin: number;
          endMin: number;
        } => r != null,
      );

    const holdRanges = activeHoldsRaw
      .map((h) =>
        this.intervalToBusinessDayRange({
          start: h.startTime,
          end: h.endTime,
          dateYmd: ymd,
          businessTimeZone: timezone,
        }),
      )
      .filter(
        (
          r,
        ): r is {
          startMin: number;
          endMin: number;
        } => r != null,
      );

    const breakRanges = [
      ...weeklyBreaksRaw.map((b) => ({
        startMin: hhmmToMinutes(b.startTime),
        endMin: hhmmToMinutes(b.endTime),
        source: 'weekly' as const,
      })),
      ...breakExceptionsRaw.map((b) => ({
        startMin: hhmmToMinutes(b.startTime),
        endMin: hhmmToMinutes(b.endTime),
        source: 'date_exception' as const,
      })),
    ];

    type TimeOffRange = {
      startMin: number;
      endMin: number;
      isAllDay: boolean;
      status: string;
      startTime: string | null;
      endTime: string | null;
    };

    const timeOffRanges = timeOffRaw
      .map((t) => {
        if (t.isAllDay) {
          return {
            startMin: 0,
            endMin: 1440,
            isAllDay: true,
            status: String(t.status),
            startTime: t.startTime,
            endTime: t.endTime,
          };
        }
        const clipped = this.intervalToBusinessDayRange({
          start: t.startDate,
          end: t.endDate,
          dateYmd: ymd,
          businessTimeZone: timezone,
        });
        if (!clipped) return null;
        return {
          startMin: clipped.startMin,
          endMin: clipped.endMin,
          isAllDay: false,
          status: String(t.status),
          startTime: t.startTime,
          endTime: t.endTime,
        };
      })
      .filter((r): r is TimeOffRange => r != null);

    const workingStartMin =
      workingHoursResolved != null
        ? hhmmToMinutes(workingHoursResolved.startTime)
        : null;
    const workingEndMin =
      workingHoursResolved != null ? hhmmToMinutes(workingHoursResolved.endTime) : null;

    const candidateStartMins: number[] = [];
    if (
      workingStartMin != null &&
      workingEndMin != null &&
      effectiveBlockMinutes != null &&
      effectiveBlockMinutes > 0
    ) {
      for (
        let m = workingStartMin;
        m + effectiveBlockMinutes <= workingEndMin;
        m += stepMinutes
      ) {
        candidateStartMins.push(m);
      }
    }

    const businessNowMin = wallHhmmStringToMinuteOfDay(businessNowHhmm);
    const requestIsToday = ymd === (businessNow.toISODate() ?? ymd);
    const relevantCandidateMins = candidateStartMins.filter((m) =>
      requestIsToday ? m >= businessNowMin : true,
    );
    const candidateMinsForReport =
      relevantCandidateMins.length > 0 ? relevantCandidateMins : candidateStartMins;

    const slotByStart = new Map(
      timeSlotsRowsRaw.map((row) => [row.startTime, row]),
    );
    const neededSlots =
      effectiveBlockMinutes == null
        ? null
        : Math.max(1, Math.ceil(effectiveBlockMinutes / stepMinutes));
    const coreDuration = staffServiceDuration ?? serviceDuration ?? 0;

    const intersects = (
      startMin: number,
      endMin: number,
      intervals: Array<{ startMin: number; endMin: number }>,
    ): boolean => {
      return intervals.some(
        (interval) => startMin < interval.endMin && endMin > interval.startMin,
      );
    };

    const removedReasonsSummary: Record<string, number> = {};
    const firstCandidateSlots = candidateMinsForReport.slice(0, 40).map((startMin) => {
      const reasons: string[] = [];
      const time = minutesToHhmm(startMin);

      if (!isDateInsideBookingWindow) reasons.push('outside_booking_window');
      if (!staffExists || !staffIsActive) reasons.push('staff_not_active_or_missing');
      if (!serviceExists || !serviceIsActive) reasons.push('service_not_active_or_missing');
      if (!serviceAssigned) reasons.push('service_not_assigned');
      if (workingStartMin == null || workingEndMin == null) {
        reasons.push('no_working_hours');
      } else if (
        effectiveBlockMinutes != null &&
        (startMin < workingStartMin || startMin + effectiveBlockMinutes > workingEndMin)
      ) {
        reasons.push('outside_working_hours');
      }
      if (requestIsToday && startMin < businessNowMin) reasons.push('before_now');
      if (isHoliday) reasons.push('holiday');
      if (
        timeOffRanges.length > 0 &&
        effectiveBlockMinutes != null &&
        intersects(startMin, startMin + effectiveBlockMinutes, timeOffRanges)
      ) {
        reasons.push('time_off');
      }

      if (
        effectiveBlockMinutes != null &&
        intersects(startMin, startMin + effectiveBlockMinutes, breakRanges)
      ) {
        reasons.push('overlaps_break');
      }

      const coreEnd = startMin + coreDuration;
      const blockEnd =
        effectiveBlockMinutes != null ? startMin + effectiveBlockMinutes : coreEnd;

      const apptCoreOverlap =
        coreDuration > 0 &&
        intersects(startMin, coreEnd, appointmentRanges);
      const apptBlockOverlap =
        blockEnd > startMin &&
        intersects(startMin, blockEnd, appointmentRanges);
      if (apptCoreOverlap) reasons.push('overlaps_appointment');
      else if (!apptCoreOverlap && apptBlockOverlap && blockEnd > coreEnd) {
        reasons.push('buffer_overlap');
      }

      const holdCoreOverlap =
        coreDuration > 0 && intersects(startMin, coreEnd, holdRanges);
      const holdBlockOverlap =
        blockEnd > startMin && intersects(startMin, blockEnd, holdRanges);
      if (holdCoreOverlap) reasons.push('overlaps_hold');
      else if (!holdCoreOverlap && holdBlockOverlap && blockEnd > coreEnd) {
        reasons.push('buffer_overlap');
      }

      if (neededSlots != null) {
        const blockedSegments: Array<{
          startTime: string;
          reason: 'missing_row' | 'not_free';
          status?: string;
        }> = [];
        for (let i = 0; i < neededSlots; i++) {
          const hhmm = minutesToHhmm(startMin + i * stepMinutes);
          const row = slotByStart.get(hhmm);
          if (!row) {
            blockedSegments.push({ startTime: hhmm, reason: 'missing_row' });
            continue;
          }
          if (row.status !== 'free') {
            blockedSegments.push({
              startTime: hhmm,
              reason: 'not_free',
              status: row.status,
            });
          }
        }
        if (blockedSegments.length > 0) {
          reasons.push('time_slot_row_blocked');
        }
      }

      if (reasons.length > 0) {
        const firstReason = reasons[0];
        removedReasonsSummary[firstReason] =
          (removedReasonsSummary[firstReason] ?? 0) + 1;
      }

      return {
        time,
        kept: reasons.length === 0,
        removedReason: reasons[0] ?? null,
        allReasons: reasons,
      };
    });

    const keptCount = firstCandidateSlots.filter((c) => c.kept).length;
    const serviceAwareTimeSlotsCount = candidateStartMins.filter((startMin) => {
      if (neededSlots == null) return false;
      for (let i = 0; i < neededSlots; i++) {
        const hhmm = minutesToHhmm(startMin + i * stepMinutes);
        const row = slotByStart.get(hhmm);
        if (!row || row.status !== 'free') return false;
      }
      return true;
    }).length;

    let reasonNoSlots = 'UNKNOWN';
    if (!staffExists || !staffIsActive) {
      reasonNoSlots = 'STAFF_NOT_FOUND_OR_INACTIVE';
    } else if (!serviceExists || !serviceIsActive) {
      reasonNoSlots = 'SERVICE_NOT_FOUND_OR_INACTIVE';
    } else if (!isDateInsideBookingWindow) {
      reasonNoSlots = 'OUTSIDE_BOOKING_WINDOW';
    } else if (!serviceAssigned) {
      reasonNoSlots = 'SERVICE_NOT_ASSIGNED_TO_STAFF';
    } else if (!workingHoursResolved) {
      reasonNoSlots = 'NO_WORKING_HOURS';
    } else if (serviceAwareTimeSlotsCount === 0) {
      reasonNoSlots = 'NO_TIME_SLOTS_PROJECTED_FOR_STAFF_SERVICE_DATE';
    } else if (isHoliday) {
      reasonNoSlots = 'BUSINESS_HOLIDAY';
    } else if (timeOffRanges.length > 0 && keptCount === 0) {
      reasonNoSlots = 'STAFF_TIME_OFF';
    } else if (requestIsToday && keptCount === 0) {
      reasonNoSlots = 'ALL_CANDIDATES_FILTERED_AFTER_BUSINESS_NOW';
    }

    const availabilityEmptyDebugResult = {
      date: ymd,
      staffId: input.query.staffId,
      serviceId: input.query.serviceId,
      reasonNoSlots,
      requestIdentity: {
        businessId: input.query.businessId,
        staffId: input.query.staffId,
        serviceId: input.query.serviceId,
        date: ymd,
        businessTimezone: timezone,
        businessNow: businessNowHhmm,
        businessNowIso,
        bookingWindowStart,
        bookingWindowEnd,
        isDateInsideBookingWindow,
        readPath: input.readPath,
      },
      staffServiceValidation: {
        staffExists,
        staffIsActive,
        serviceExists,
        serviceIsActive,
        serviceDuration,
        serviceBufferBefore,
        serviceBufferAfter,
        serviceAssigned,
        staffServiceDuration,
        effectiveBlockMinutes,
        reasonServiceNotAssigned: serviceAssigned
          ? null
          : 'REASON_NO_SLOTS = SERVICE_NOT_ASSIGNED_TO_STAFF',
      },
      workingHours: {
        source: workingHoursSource,
        dayOfWeek,
        date: ymd,
        isClosed: isClosedByOverride,
        startTime: workingHoursResolved?.startTime ?? null,
        endTime: workingHoursResolved?.endTime ?? null,
        reasonNoWorkingHours: workingHoursResolved
          ? null
          : 'REASON_NO_SLOTS = NO_WORKING_HOURS',
      },
      blockingRanges: {
        appointmentsCount: appointmentsRaw.length,
        appointments: appointmentsRaw.map((a) => ({
          id: a.id,
          status: a.status,
          startLocal: formatInstantLocalHhmm(a.startTime, timezone),
          endLocal: formatInstantLocalHhmm(a.endTime, timezone),
        })),
        breaksCount: breakRanges.length,
        breaks: breakRanges.map((b) => ({
          source: b.source,
          start: minutesToHhmm(b.startMin),
          end: minutesToHhmm(b.endMin),
        })),
        timeOffCount: timeOffRanges.length,
        timeOff: timeOffRanges.map((t) => ({
          start: minutesToHhmm(t.startMin),
          end: minutesToHhmm(t.endMin),
          isAllDay: t.isAllDay,
          status: t.status,
          startTime: t.startTime,
          endTime: t.endTime,
        })),
        holidaysCount: holidaysRaw.length,
        holidays: holidaysRaw.map((h) => ({
          name: h.name ?? null,
          isRecurring: h.isRecurring,
          dateLocal:
            h.date != null ? formatBusinessTime(h.date, timezone, 'yyyy-MM-dd') : null,
        })),
        holdsCount: activeHoldsRaw.length,
        activeHolds: activeHoldsRaw.map((h) => ({
          id: h.id,
          startLocal: formatInstantLocalHhmm(h.startTime, timezone),
          endLocal: formatInstantLocalHhmm(h.endTime, timezone),
          expiresAtIso: h.expiresAt.toISOString(),
        })),
      },
      timeSlotsPath: {
        timeSlotsCount: timeSlotsRowsRaw.length,
        serviceAwareTimeSlotsCount,
        first10Rows: timeSlotsRowsRaw.slice(0, 10).map((r) => ({
          id: r.id,
          startTime: r.startTime,
          endMin: r.endMin,
          durationMinutes: r.durationMinutes,
          status: r.status,
          holdId: r.holdId,
          appointmentId: r.appointmentId,
        })),
        reasonNoTimeSlots:
          serviceAwareTimeSlotsCount === 0
            ? 'REASON_NO_SLOTS = NO_TIME_SLOTS_PROJECTED_FOR_STAFF_SERVICE_DATE'
            : null,
      },
      serviceAssigned,
      timeSlotsCount: timeSlotsRowsRaw.length,
      appointmentsCount: appointmentsRaw.length,
      breaksCount: breakRanges.length,
      holdsCount: activeHoldsRaw.length,
      firstCandidateSlots,
      removedReasonsSummary,
    };

    console.log(
      JSON.stringify({
        AVAILABILITY_EMPTY_DEBUG_RESULT: availabilityEmptyDebugResult,
      }),
    );
  }

  /**
   * List appointments for a business with optional filters.
   */
  async findAll(
    businessId: string,
    opts?: {
      branchId?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      staffId?: string;
      customerId?: string;
      limit?: number;
      page?: number;
    },
    viewer?: {
      userId?: string;
      role?: string;
    },
  ) {
    const limit = opts?.limit ?? 50;
    const page = opts?.page ?? 1;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      businessId,
    };
    if (opts?.branchId) where.branchId = opts.branchId;
    if (opts?.staffId) where.staffId = opts.staffId;
    if (opts?.customerId) where.customerId = opts.customerId;
    if (opts?.status) where.status = opts.status;

    if (opts?.startDate || opts?.endDate) {
      where.startTime = {};
      if (opts.startDate) {
        (where.startTime as Record<string, Date>).gte = DateTime.fromISO(
          String(opts.startDate).slice(0, 10),
          { zone: 'utc' },
        )
          .startOf('day')
          .toJSDate();
      }
      if (opts.endDate) {
        (where.startTime as Record<string, Date>).lte = DateTime.fromISO(
          String(opts.endDate).slice(0, 10),
          { zone: 'utc' },
        )
          .endOf('day')
          .toJSDate();
      }
    }

    const orderBy = opts?.startDate || opts?.endDate
      ? { startTime: 'asc' as const }
      : { startTime: 'desc' as const };

    const [rawAppointments, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        include: {
          staff: { select: { id: true, firstName: true, lastName: true } },
          service: { select: { id: true, name: true, durationMinutes: true, price: true } },
          customer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, tagColor: true } },
          branch: { select: { id: true, name: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.appointment.count({ where }),
    ]);

    let appointments = rawAppointments;
    if (viewer?.role === 'staff') {
      const [business, viewerStaff] = await Promise.all([
        this.prisma.business.findUnique({
          where: { id: businessId },
          select: { settings: true },
        }),
        viewer.userId
          ? this.prisma.staff.findFirst({
              where: {
                businessId,
                userId: viewer.userId,
                deletedAt: null,
              },
              select: { branchId: true },
            })
          : Promise.resolve(null),
      ]);
      const generalSettings =
        ((business?.settings as { generalSettings?: { showCustomerPhoneToEmployees?: boolean } } | null)
          ?.generalSettings) ?? {};
      const showCustomerPhoneToEmployees =
        generalSettings.showCustomerPhoneToEmployees === true;
      const viewerBranchId = viewerStaff?.branchId ?? null;

      appointments = rawAppointments.map((appointment) => {
        const appointmentBranchId = appointment.branchId ?? appointment.branch?.id ?? null;
        const sameBranch = appointmentBranchId === viewerBranchId;
        const allowPhone = showCustomerPhoneToEmployees && sameBranch;
        return {
          ...appointment,
          customer: {
            ...appointment.customer,
            phone: allowPhone ? appointment.customer.phone : null,
          },
        };
      });
    }

    return { appointments, total, page, limit };
  }

  /**
   * One staff, one service, per calendar day — Redis cache-aside + computed on miss.
   * `days` (1–7): consecutive UTC days from `date`, each row has that day's slots (reduces herd contention).
   */
  async getAvailability(
    query: AvailabilityQueryDto,
    viewerUserId?: string,
    timingForHeader?: GetAvailabilityHttpTiming,
  ): Promise<AvailabilityResult[]> {
    const t0 = wallClockMs();
    const operation = 'GET /availability';
    const timingSink = timingForHeader ?? this.createAvailabilityTimingCollector();
    try {
      if (this.useTimeSlots) {
        this.availabilityMetrics.recordAvailabilityReadPath('time_slots');
        this.emitPerfPhase({
          event: 'AVAILABILITY_PHASE',
          operation,
          requestType: 'availability',
          phase: 'availability_read_dispatch',
          phaseMs: 0,
          totalMs: wallClockMs() - t0,
          businessId: query.businessId,
          staffId: query.staffId,
          serviceId: query.serviceId,
          date: query.date.slice(0, 10),
          outcome: 'time_slots',
        });
        const out = await this.getAvailabilityFromTimeSlots(query, timingSink);
        await this.maybeEmitAvailabilityEmptyDebugResult({
          query,
          results: out,
          readPath: 'time_slots',
        });
        this.emitPerfPhase({
          event: 'AVAILABILITY_PHASE',
          operation,
          requestType: 'availability',
          phase: 'total',
          phaseMs: wallClockMs() - t0,
          totalMs: wallClockMs() - t0,
          businessId: query.businessId,
          staffId: query.staffId,
          serviceId: query.serviceId,
          date: query.date.slice(0, 10),
        });
        this.availabilityMetrics.recordEndpointDuration(wallClockMs() - t0);
        return out;
      }

      this.availabilityMetrics.recordAvailabilityReadPath('computed');
      const baseYmd = query.date.slice(0, 10);
      const dayCount = Math.min(7, Math.max(1, query.days ?? 1));
      const results: AvailabilityResult[] = [];

      const tBiz0 = wallClockMs();
      const { timezone: businessTimezone } = await this.getBusinessTimezone(
        query.businessId,
      );
      const bookingBusinessTzMs = wallClockMs() - tBiz0;
      this.emitPerfPhase({
        event: 'AVAILABILITY_PHASE',
        operation,
        requestType: 'availability',
        phase: 'availability_business_timezone',
        phaseMs: bookingBusinessTzMs,
        totalMs: wallClockMs() - t0,
        businessId: query.businessId,
        staffId: query.staffId,
        serviceId: query.serviceId,
        date: baseYmd,
      });
      const businessNowDt = getBusinessNow(businessTimezone);
      const businessNowHhmm = businessNowDt.toFormat('HH:mm');
      const businessNowIso =
        businessNowDt.toISO({ includeOffset: true }) ?? businessNowDt.toString();

      const readRepairOn = this.config.get<string>('AVAILABILITY_READ_REPAIR') !== '0';
      const occupiedSink = readRepairOn
        ? { appts: [] as Array<{ startTime: Date; endTime: Date }>, holds: [] as Array<{ startTime: Date; endTime: Date }>, effectiveBlockMinutes: null as number | null }
        : undefined;

      const tDayMap0 = wallClockMs();
      const dayMap = await this.computedAvailability.getAvailabilityDayMap(
        query.businessId,
        query.staffId,
        query.serviceId,
        baseYmd,
        dayCount,
        {
          businessTimeZone: businessTimezone,
          timingHeaderSink: timingSink.dayMap,
          occupiedSpansSink: occupiedSink,
        },
      );
      const dayMapCallMs = wallClockMs() - tDayMap0;
      this.emitPerfPhase({
        event: 'AVAILABILITY_PHASE',
        operation,
        requestType: 'availability',
        phase: 'availability_day_map',
        phaseMs: dayMapCallMs,
        totalMs: wallClockMs() - t0,
        businessId: query.businessId,
        staffId: query.staffId,
        serviceId: query.serviceId,
        date: baseYmd,
      });

      if (this.config.get<string>('LOG_AVAILABILITY_CACHE_DEBUG') === '1') {
        console.log(
          JSON.stringify({
            scope: 'BookingService.getAvailability',
            computeMs: wallClockMs() - t0,
            note:
              'after dayMap: read-repair uses occupied spans from dayMap (no duplicate UNION)',
            days: dayCount,
            staffId: query.staffId,
            serviceId: query.serviceId,
            date: baseYmd,
          }),
        );
      }

      const inWindowDaysPre: string[] = [];
      for (let i = 0; i < dayCount; i++) {
        const ds = addBusinessDaysFromYmd(businessTimezone, baseYmd, i);
        if (this.computedAvailability.isWithinBookingWindow(ds, businessTimezone)) {
          inWindowDaysPre.push(ds);
        }
      }

      // Read repair: reuse occupied spans already fetched by getAvailabilityDayMap (no extra DB queries)
      let readRepairOccupied: ReadRepairSpan[] | null = null;
      let readRepairBlockMin: number | null = null;
      const tAfterDayMap0 = wallClockMs();
      if (readRepairOn && occupiedSink) {
        readRepairBlockMin = occupiedSink.effectiveBlockMinutes;
        if (readRepairBlockMin != null && inWindowDaysPre.length > 0) {
          const alwaysRepair =
            this.config.get<string>('AVAILABILITY_READ_REPAIR_ALWAYS') === '1';
          let runReadRepair = alwaysRepair;
          if (!runReadRepair) {
            const rawChurn = parseInt(
              this.config.get<string>('AVAILABILITY_READ_REPAIR_CHURN_WINDOW_DAYS', '7'),
              10,
            );
            const churnDays = Number.isFinite(rawChurn) ? Math.max(0, rawChurn) : 7;
            const todayYmd = businessNowDt.toFormat('yyyy-MM-dd');
            const endChurnYmd = businessNowDt
              .plus({ days: churnDays })
              .toFormat('yyyy-MM-dd');
            runReadRepair = inWindowDaysPre.some(
              (d) => d >= todayYmd && d <= endChurnYmd,
            );
          }
          if (runReadRepair) {
            let anyOffered = false;
            for (const ds of inWindowDaysPre) {
              if ((dayMap.get(ds)?.slots.length ?? 0) > 0) {
                anyOffered = true;
                break;
              }
            }
            if (anyOffered) {
              readRepairOccupied = [
                ...occupiedSink.appts.map((span) => ({
                  ...span,
                  source: 'appointment' as const,
                })),
                ...occupiedSink.holds.map((span) => ({
                  ...span,
                  source: 'slot_hold' as const,
                })),
              ];
            }
          }
        }
      }

      for (let i = 0; i < dayCount; i++) {
        const dateStr = addBusinessDaysFromYmd(businessTimezone, baseYmd, i);
        if (!this.computedAvailability.isWithinBookingWindow(dateStr, businessTimezone)) {
          continue;
        }

        const computed = dayMap.get(dateStr) ?? { slots: [] };

        let slots = computed.slots;
        if (readRepairOccupied != null && readRepairBlockMin != null && slots.length > 0) {
          slots = this.computedAvailability.filterOfferedSlotsReadRepair(
            slots,
            dateStr,
            businessTimezone,
            readRepairBlockMin,
            readRepairOccupied,
          );
        }
        const chronological = query.chronologicalSlots === true;
        if (chronological) {
          slots = [...slots].sort((a, b) => hhmmToMinutes(a) - hhmmToMinutes(b));
        } else if (viewerUserId) {
          slots = diversifySlotsForViewer(slots, viewerUserId, `${query.staffId}|${dateStr}`);
        }
        if (query.maxSlotsPerRow != null && query.maxSlotsPerRow > 0) {
          slots = slots.slice(0, query.maxSlotsPerRow);
        }

        if (process.env.LOG_AVAILABILITY_COMPACT_DEBUG === '1') {
          console.log('COMPACT VALUE:', query.compact);
          console.log('SLOTS LENGTH:', slots.length);
        }

        if (this.config.get<string>('LOG_AVAILABILITY_STAFF_SLOTS') === '1') {
          console.log(`staff ${query.staffId} slots:`, slots.length);
          if (slots.length === 0) {
            console.warn('[availability] ZERO slots — GET /availability (final row)', {
              businessId: query.businessId,
              staffId: query.staffId,
              serviceId: query.serviceId,
              date: dateStr,
              dayIndex: i,
              maxSlotsPerRow: query.maxSlotsPerRow ?? null,
            });
          }
        }

        const row: AvailabilityResult = {
          date: dateStr,
          staffId: query.staffId,
          slots,
          businessTimezone,
          businessNow: businessNowHhmm,
        };
        if (query.compact !== true && computed.staffFirstName != null) {
          row.staffName =
            `${computed.staffFirstName} ${computed.staffLastName ?? ''}`.trim();
        }
        if (query.compact !== true && slots.length > 0) {
          row.slotsDetail = slots.map((hhmm) => {
            const wall = getStartOfDay(dateStr, businessTimezone).set({
              hour: parseInt(hhmm.slice(0, 2), 10),
              minute: parseInt(hhmm.slice(3, 5), 10),
              second: 0,
              millisecond: 0,
            });
            return {
              startUtc: wall.toUTC().toISO() ?? '',
              businessTime: hhmm,
            };
          });
        }
        results.push(row);
      }

      if (results.length === 0) {
        results.push({
          date: baseYmd,
          staffId: query.staffId,
          slots: [],
          businessTimezone,
          businessNow: businessNowHhmm,
          businessNowIso,
        });
      }

      const bookingAfterDayMapMs = wallClockMs() - tAfterDayMap0;
      this.emitPerfPhase({
        event: 'AVAILABILITY_PHASE',
        operation,
        requestType: 'availability',
        phase: 'availability_post_day_map',
        phaseMs: bookingAfterDayMapMs,
        totalMs: wallClockMs() - t0,
        businessId: query.businessId,
        staffId: query.staffId,
        serviceId: query.serviceId,
        date: baseYmd,
      });

      timingSink.populated = true;
      timingSink.envelope.totalMs = wallClockMs() - t0;
      timingSink.envelope.bookingBusinessTzMs = bookingBusinessTzMs;
      timingSink.envelope.dayMapCallMs = dayMapCallMs;
      timingSink.envelope.bookingAfterDayMapMs = bookingAfterDayMapMs;

      if (process.env.LOG_AVAILABILITY_INTERNAL_TIMING === '1') {
        const totalMs = wallClockMs() - t0;
        console.log(
          JSON.stringify({
            type: 'GET_AVAILABILITY_ENVELOPE',
            requestId: getRequestId(),
            totalMs,
            bookingBusinessTzMs,
            dayMapCallMs,
            bookingAfterDayMapMs,
            note: 'dayMapCallMs wraps AVAILABILITY_INTERNAL_TIMING (redis/db/compute inside getAvailabilityDayMap).',
          }),
        );
      }

      const serializationMs = this.measureSerializationMs(results);
      this.emitPerfPhase({
        event: 'AVAILABILITY_PHASE',
        operation,
        requestType: 'availability',
        phase: 'response_serialization',
        phaseMs: serializationMs,
        totalMs: wallClockMs() - t0,
        businessId: query.businessId,
        staffId: query.staffId,
        serviceId: query.serviceId,
        date: baseYmd,
      });
      this.emitPerfPhase({
        event: 'AVAILABILITY_PHASE',
        operation,
        requestType: 'availability',
        phase: 'total',
        phaseMs: wallClockMs() - t0,
        totalMs: wallClockMs() - t0,
        businessId: query.businessId,
        staffId: query.staffId,
        serviceId: query.serviceId,
        date: baseYmd,
      });
      await this.maybeEmitAvailabilityEmptyDebugResult({
        query,
        results,
        readPath: 'computed',
      });
      this.availabilityMetrics.recordEndpointDuration(wallClockMs() - t0);
      return results;
    } finally {
      const totalMs =
        timingSink.envelope.totalMs > 0
          ? timingSink.envelope.totalMs
          : wallClockMs() - t0;
      const redisMs = timingSink.dayMap.redisMs ?? 0;
      const dbMs =
        (timingSink.envelope.bookingBusinessTzMs ?? 0) + (timingSink.dayMap.dbMs ?? 0);
      const dbQueries = getPrismaMiddlewareQueryRecords();
      const dbQueryCount = dbQueries.length;
      const totalDbTime = getPrismaQueryDurationMs() ?? 0;
      const slowQueries = dbQueries
        .filter((q) => q.durationMs > 100)
        .map((q) => ({
          type: q.model === 'raw' ? 'raw' : `${q.model}.${q.action}`,
          ms: q.durationMs,
        }));
      const slowDbQueryCount = slowQueries.length;
      const queryFrequency = dbQueries.reduce<Record<string, number>>((acc, q) => {
        const key = q.model === 'raw' ? 'raw' : `${q.model}.${q.action}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
      const repeatedQueries = Object.entries(queryFrequency)
        .filter(([, count]) => count > 1)
        .map(([type, count]) => ({ type, count }));
      this.logger.log(
        JSON.stringify({
          type: 'GET_AVAILABILITY_DB_PROFILE',
          requestId: getRequestId(),
          endpoint: 'availability',
          totalDbQueries: dbQueryCount,
          totalDbTime,
          slowQueryCount: slowDbQueryCount,
          slowQueries,
          queryFrequency,
          repeatedQueries,
        }),
      );
      const computeMs = Math.max(0, totalMs - dbMs - redisMs);
      this.emitFlowTiming({
        step: 'availability',
        dbMs,
        redisMs,
        redisCallCount: timingSink.dayMap.redisCallCount ?? 0,
        payloadSizeBytes: timingSink.dayMap.payloadSizeBytes ?? 0,
        keysPerRequest: timingSink.dayMap.keysPerRequest ?? 0,
        dbQueryCount,
        slowDbQueryCount,
        computeMs,
        totalMs,
      });
    }
  }

  /**
   * Reads from `time_slots` (Postgres). Redis first when `ENABLE_REDIS=true` and
   * `AVAILABILITY_REDIS_CACHE=1` — key `availability:{businessId}:{staffId}:{date}`.
   */
  private async getAvailabilityFromTimeSlots(
    query: AvailabilityQueryDto,
    timingForHeader?: GetAvailabilityHttpTiming,
  ): Promise<AvailabilityResult[]> {
    const t0 = wallClockMs();
    const operation = 'GET /availability';
    const baseYmd = query.date.slice(0, 10);
    const dayCount = Math.min(7, Math.max(1, query.days ?? 1));
    const useRedis = this.availabilityTimeSlotsRedisCacheOn;

    let bookingBusinessTzMs = 0;
    let redisMs = 0;
    let redisPayloadSizeBytes = 0;
    let redisKeysTouched = 0;
    let dbMs = 0;

    const tTz0 = wallClockMs();
    const { timezone: tzRaw } = await this.getBusinessTimezone(query.businessId);
    bookingBusinessTzMs = wallClockMs() - tTz0;
    this.emitPerfPhase({
      event: 'AVAILABILITY_PHASE',
      operation,
      requestType: 'availability',
      phase: 'availability_business_timezone',
      phaseMs: bookingBusinessTzMs,
      totalMs: wallClockMs() - t0,
      businessId: query.businessId,
      staffId: query.staffId,
      serviceId: query.serviceId,
      date: baseYmd,
    });

    const businessTimezone = tzRaw;
    const businessNowDt = getBusinessNow(businessTimezone);

    const ymds: string[] = [];
    const inWindowByIndex: boolean[] = [];
    const inWindowIndices: number[] = [];
    const cacheKeysByIndex: Array<string | null> = new Array(dayCount).fill(null);
    const inWindowCacheKeys: string[] = [];
    const inWindowDirtyWindowKeys: string[] = [];
    for (let i = 0; i < dayCount; i++) {
      const ymd = addBusinessDaysFromYmd(businessTimezone, baseYmd, i);
      ymds.push(ymd);
      const inWindow = this.computedAvailability.isWithinBookingWindow(
        ymd,
        businessTimezone,
      );
      inWindowByIndex.push(inWindow);
      if (!inWindow) continue;
      inWindowIndices.push(i);
      const cacheKey = CacheService.keys.availabilityHotDay(
        query.businessId,
        query.staffId,
        ymd,
      );
      const dirtyWindowKey = CacheService.keys.availabilityRescheduleDirtyWindows(
        query.businessId,
        query.staffId,
        ymd,
      );
      cacheKeysByIndex[i] = cacheKey;
      inWindowCacheKeys.push(cacheKey);
      inWindowDirtyWindowKeys.push(dirtyWindowKey);
    }

    const dirtyWindowsByIndex: DirtyWindow[][] = new Array(dayCount)
      .fill(null)
      .map(() => []);
    const redisReadKeys = useRedis
      ? [...inWindowDirtyWindowKeys, ...inWindowCacheKeys]
      : inWindowDirtyWindowKeys;
    const redisReadCallCount = redisReadKeys.length > 0 ? 1 : 0;
    const tRedisRead0 = wallClockMs();
    const redisReadRaw =
      redisReadKeys.length > 0
        ? await this.cache.mget<unknown>(redisReadKeys)
        : [];
    redisMs += wallClockMs() - tRedisRead0;
    redisKeysTouched += redisReadKeys.length;
    redisPayloadSizeBytes += this.estimatePayloadSizeBytes(redisReadRaw);
    const inWindowDayCount = inWindowIndices.length;
    const dirtyRaw = redisReadRaw.slice(0, inWindowDayCount);
    const rawEntries = useRedis
      ? redisReadRaw.slice(inWindowDayCount, inWindowDayCount + inWindowDayCount)
      : [];
    for (let pos = 0; pos < inWindowIndices.length; pos++) {
      const i = inWindowIndices[pos];
      dirtyWindowsByIndex[i] = this.parseDirtyWindowsPayload(dirtyRaw[pos]);
    }
    this.emitPerfPhase({
      event: 'AVAILABILITY_PHASE',
      operation,
      requestType: 'availability',
      phase: 'availability_reschedule_dirty_marker_check',
      phaseMs: wallClockMs() - tRedisRead0,
      totalMs: wallClockMs() - t0,
      businessId: query.businessId,
      staffId: query.staffId,
      serviceId: query.serviceId,
      date: baseYmd,
    });

    let blockAndMetaMs = 0;
    let daySlotQueryMs = 0;
    let dirtyDayNarrowFallbackMs = 0;
    const slotsByDayIndex: string[][] = new Array(dayCount)
      .fill(null)
      .map(() => []);
    const ttl = getAvailabilityTimeSlotsCacheTtlSec();
    let missDays = 0;
    let blockMin: number | null = null;

    if (useRedis) {
      this.emitPerfPhase({
        event: 'AVAILABILITY_PHASE',
        operation,
        requestType: 'availability',
        phase: 'availability_hot_cache_mget',
        phaseMs: wallClockMs() - tRedisRead0,
        totalMs: wallClockMs() - t0,
        businessId: query.businessId,
        staffId: query.staffId,
        serviceId: query.serviceId,
        date: baseYmd,
        cacheKey: inWindowCacheKeys.join(','),
        cacheHit: rawEntries.every((entry) => entry != null),
      });

      const blobsByDayIndex: Array<ReturnType<typeof parseTimeSlotsDayBlob>> =
        new Array(dayCount).fill(null);
      for (let pos = 0; pos < inWindowIndices.length; pos++) {
        const i = inWindowIndices[pos];
        blobsByDayIndex[i] = parseTimeSlotsDayBlob(rawEntries[pos]);
      }
      const missIdx: number[] = [];
      const svc = query.serviceId;

      for (const i of inWindowIndices) {
        const slots = blobsByDayIndex[i]?.byService[svc];
        if (slots != null) {
          slotsByDayIndex[i] = slots;
        } else {
          missIdx.push(i);
        }
      }
      missDays = missIdx.length;

      if (missIdx.length > 0) {
        const tBlock0 = wallClockMs();
        blockMin = await this.hotAvailabilityCache.getBlockMinutesCached(
          query.businessId,
          query.staffId,
          query.serviceId,
        );
        blockAndMetaMs += wallClockMs() - tBlock0;
        this.emitPerfPhase({
          event: 'AVAILABILITY_PHASE',
          operation,
          requestType: 'availability',
          phase: 'availability_block_meta_lookup',
          phaseMs: wallClockMs() - tBlock0,
          totalMs: wallClockMs() - t0,
          businessId: query.businessId,
          staffId: query.staffId,
          serviceId: query.serviceId,
          date: baseYmd,
        });

        for (const i of missIdx) {
          const ymd = ymds[i];
          const key = cacheKeysByIndex[i];
          if (!key) continue;
          const tDay0 = wallClockMs();
          const slots =
            blockMin != null
              ? await this.timeSlots.getFreeSlotsForBookingBlock(
                  query.staffId,
                  ymd,
                  blockMin,
                )
              : await this.timeSlots.getFreeSlots(query.staffId, ymd);
          daySlotQueryMs += wallClockMs() - tDay0;
          this.emitPerfPhase({
            event: 'AVAILABILITY_PHASE',
            operation,
            requestType: 'availability',
            phase: 'availability_time_slots_db_compute',
            phaseMs: wallClockMs() - tDay0,
            totalMs: wallClockMs() - t0,
            businessId: query.businessId,
            staffId: query.staffId,
            serviceId: query.serviceId,
            date: ymd,
            cacheHit: false,
          });
          slotsByDayIndex[i] = slots;

          const prev = blobsByDayIndex[i];
          const nextBlob: TimeSlotsDayRedisBlob = {
            v: 1,
            byService: {
              ...(prev?.byService ?? {}),
              [svc]: slots,
            },
          };
          if (dirtyWindowsByIndex[i].length === 0) {
            const tSet0 = wallClockMs();
            await this.cache.set(key, nextBlob, ttl);
            redisMs += wallClockMs() - tSet0;
            this.emitPerfPhase({
              event: 'AVAILABILITY_PHASE',
              operation,
              requestType: 'availability',
              phase: 'availability_hot_cache_set',
              phaseMs: wallClockMs() - tSet0,
              totalMs: wallClockMs() - t0,
              businessId: query.businessId,
              staffId: query.staffId,
              serviceId: query.serviceId,
              date: ymd,
              cacheKey: key,
              cacheHit: false,
            });
          }
        }
      }

      dbMs = blockAndMetaMs + daySlotQueryMs;
      const path = missDays === 0 ? 'cache_hit' : 'cache_miss';
      this.logger.log(
        JSON.stringify({
          path,
          redisMs: Math.round(redisMs),
          redisCallCount: redisReadCallCount,
          payloadSizeBytes: redisPayloadSizeBytes,
          keysPerRequest: redisKeysTouched,
          dbMs: Math.round(dbMs),
          totalMs: Math.round(wallClockMs() - t0),
          tzMs: Math.round(bookingBusinessTzMs),
          dayHits: inWindowDayCount - missDays,
          dayMisses: missDays,
          dayOutOfWindow: dayCount - inWindowDayCount,
          businessId: query.businessId,
          staffId: query.staffId,
          serviceId: query.serviceId,
        }),
      );
    } else {
      const tBlock0 = wallClockMs();
      blockMin = await this.hotAvailabilityCache.getBlockMinutesCached(
        query.businessId,
        query.staffId,
        query.serviceId,
      );
      blockAndMetaMs = wallClockMs() - tBlock0;
      this.emitPerfPhase({
        event: 'AVAILABILITY_PHASE',
        requestType: 'availability',
        phase: 'availability_block_meta_lookup',
        phaseMs: blockAndMetaMs,
        totalMs: wallClockMs() - t0,
        businessId: query.businessId,
        staffId: query.staffId,
        date: baseYmd,
      });

      for (const i of inWindowIndices) {
        const ymd = ymds[i];
        const tDay0 = wallClockMs();
        const slots =
          blockMin != null
            ? await this.timeSlots.getFreeSlotsForBookingBlock(
                query.staffId,
                ymd,
                blockMin,
              )
            : await this.timeSlots.getFreeSlots(query.staffId, ymd);
        daySlotQueryMs += wallClockMs() - tDay0;
        this.emitPerfPhase({
          event: 'AVAILABILITY_PHASE',
          requestType: 'availability',
          phase: 'availability_time_slots_db_compute',
          phaseMs: wallClockMs() - tDay0,
          totalMs: wallClockMs() - t0,
          businessId: query.businessId,
          staffId: query.staffId,
          date: ymd,
        });
        slotsByDayIndex[i] = slots;
      }
      dbMs = bookingBusinessTzMs + blockAndMetaMs + daySlotQueryMs;
    }

    for (const i of inWindowIndices) {
      const windows = dirtyWindowsByIndex[i];
      if (windows.length === 0) continue;
      const ymd = ymds[i];
      const tDirtyFallback0 = wallClockMs();
      slotsByDayIndex[i] = await this.applyDirtyDayNarrowFallback({
        businessId: query.businessId,
        staffId: query.staffId,
        dateYmd: ymd,
        businessTimeZone: businessTimezone,
        blockMinutes: blockMin ?? 1,
        projectedStarts: slotsByDayIndex[i] ?? [],
        windows,
      });
      dirtyDayNarrowFallbackMs += wallClockMs() - tDirtyFallback0;
      this.emitPerfPhase({
        event: 'AVAILABILITY_PHASE',
        operation,
        requestType: 'availability',
        phase: 'availability_dirty_day_narrow_fallback',
        phaseMs: wallClockMs() - tDirtyFallback0,
        totalMs: wallClockMs() - t0,
        businessId: query.businessId,
        staffId: query.staffId,
        serviceId: query.serviceId,
        date: ymd,
      });
    }

    const overlaysByDay: AvailabilityOverlayEntry[][] = new Array(dayCount);
    for (let i = 0; i < dayCount; i++) {
      if (!inWindowByIndex[i]) {
        overlaysByDay[i] = [];
        continue;
      }
      const tOverlay0 = wallClockMs();
      overlaysByDay[i] = await this.availabilityOverlay.getDayEntries(
        query.businessId,
        query.staffId,
        ymds[i],
      );
      redisMs += wallClockMs() - tOverlay0;
      this.emitPerfPhase({
        event: 'AVAILABILITY_PHASE',
        requestType: 'availability',
        phase: 'availability_overlay_read',
        phaseMs: wallClockMs() - tOverlay0,
        totalMs: wallClockMs() - t0,
        businessId: query.businessId,
        staffId: query.staffId,
        date: ymds[i],
      });
    }

    if (blockMin == null && overlaysByDay.some((overlay) => overlay.length > 0)) {
      const tBlock0 = wallClockMs();
      blockMin = await this.hotAvailabilityCache.getBlockMinutesCached(
        query.businessId,
        query.staffId,
        query.serviceId,
      );
      blockAndMetaMs += wallClockMs() - tBlock0;
      this.emitPerfPhase({
        event: 'AVAILABILITY_PHASE',
        requestType: 'availability',
        phase: 'availability_overlay_block_meta_lookup',
        phaseMs: wallClockMs() - tBlock0,
        totalMs: wallClockMs() - t0,
        businessId: query.businessId,
        staffId: query.staffId,
        date: baseYmd,
      });
    }

    for (let i = 0; i < dayCount; i++) {
      const overlay = overlaysByDay[i];
      if (overlay.length > 0) {
        slotsByDayIndex[i] = this.filterSlotsByOverlay(
          slotsByDayIndex[i],
          blockMin ?? 1,
          overlay,
        );
      }
    }

    const slotDbMsOnly = useRedis
      ? blockAndMetaMs + daySlotQueryMs + dirtyDayNarrowFallbackMs
      : bookingBusinessTzMs + blockAndMetaMs + daySlotQueryMs + dirtyDayNarrowFallbackMs;

    const tShape0 = wallClockMs();
    const results: AvailabilityResult[] = [];
    for (let i = 0; i < dayCount; i++) {
      const ymd = ymds[i];
      const slots = inWindowByIndex[i] ? slotsByDayIndex[i] : [];
      const row: AvailabilityResult = {
        date: ymd,
        staffId: query.staffId,
        slots,
        businessTimezone,
        businessNow: businessNowDt.toFormat('HH:mm'),
        businessNowIso:
          businessNowDt.toISO({ includeOffset: true }) ?? businessNowDt.toString(),
      };
      if (query.compact !== true && slots.length > 0) {
        row.slotsDetail = slots.map((hhmm) => {
          const wall = getStartOfDay(ymd, businessTimezone).set({
            hour: parseInt(hhmm.slice(0, 2), 10),
            minute: parseInt(hhmm.slice(3, 5), 10),
            second: 0,
            millisecond: 0,
          });
          return {
            startUtc: wall.toUTC().toISO() ?? '',
            businessTime: hhmm,
          };
        });
      }
      results.push(row);
    }
    this.emitPerfPhase({
      event: 'AVAILABILITY_PHASE',
      operation,
      requestType: 'availability',
      phase: 'response_shape_build',
      phaseMs: wallClockMs() - tShape0,
      totalMs: wallClockMs() - t0,
      businessId: query.businessId,
      staffId: query.staffId,
      serviceId: query.serviceId,
      date: baseYmd,
    });

    const totalMs = wallClockMs() - t0;
    if (timingForHeader) {
      timingForHeader.populated = true;
      timingForHeader.dayMap.path = 'time_slots_table';
      timingForHeader.dayMap.totalMs = Math.round(totalMs);
      timingForHeader.dayMap.redisMs = Math.round(useRedis ? redisMs : 0);
      timingForHeader.dayMap.redisCallCount = redisReadCallCount;
      timingForHeader.dayMap.payloadSizeBytes = redisPayloadSizeBytes;
      timingForHeader.dayMap.keysPerRequest = redisKeysTouched;
      timingForHeader.dayMap.dbMs = Math.round(slotDbMsOnly);
      timingForHeader.dayMap.busyPrepMs = 0;
      timingForHeader.dayMap.computeMs = 0;
      timingForHeader.envelope.totalMs = Math.round(totalMs);
      timingForHeader.envelope.bookingBusinessTzMs = Math.round(
        bookingBusinessTzMs,
      );
      timingForHeader.envelope.dayMapCallMs = Math.round(
        blockAndMetaMs + daySlotQueryMs + dirtyDayNarrowFallbackMs,
      );
      timingForHeader.envelope.bookingAfterDayMapMs = 0;
    }

    if (process.env.LOG_SLOT_HOLD_PERF === '1') {
      console.log(
        JSON.stringify({
          type: 'TIME_SLOTS_AVAILABILITY',
          totalMs: Math.round(totalMs),
          days: dayCount,
          staffId: query.staffId,
          slotsTotal: results.reduce((s, r) => s + r.slots.length, 0),
          redisCache: useRedis,
        }),
      );
    }

    const serializationMs = this.measureSerializationMs(results);
    this.emitPerfPhase({
      event: 'AVAILABILITY_PHASE',
      operation,
      requestType: 'availability',
      phase: 'response_serialization',
      phaseMs: serializationMs,
      totalMs: wallClockMs() - t0,
      businessId: query.businessId,
      staffId: query.staffId,
      serviceId: query.serviceId,
      date: baseYmd,
    });

    return results;
  }

  /** Waitlist conversion: place hold then confirm (idempotent per waitlist row). */
  async confirmFromWaitlistConversion(dto: ConvertWaitlistDto, actorUserId: string) {
    const { hold } = await this.createSlotHoldForSlotSelection(
      {
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        customerId: dto.customerId,
        date: dto.date,
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes,
      },
      actorUserId,
    );
    return this.confirmBookingFromHold({
      businessId: dto.businessId,
      slotHoldId: hold.id,
      idempotencyKey: `waitlist:${dto.waitlistId}`,
      branchId: dto.branchId,
      locationId: dto.locationId,
    });
  }

  async createSlotHoldForSlotSelection(dto: CreateSlotHoldRequestDto, userId: string) {
    const t0 = wallClockMs();
    const operation = 'POST /appointments/slot-holds';
    let requestParsingMs = 0;
    let preValidationMs = 0;
    let validationCacheReadMs = 0;
    let validationRebuildMs = 0;
    let dbAcquireHoldMs = 0;
    let redisMs = 0;
    let postHoldInvalidationMs = 0;
    let slotLockKey: string | null = null;
    let slotLockToken: string | null = null;
    let resultHoldId: string | undefined;
    let statusCode = 500;
    let resultType: 'success' | 'conflict' | 'error' = 'error';
    let conflictCode: string | undefined;
    let errorCode: string | undefined;
    const dateYmd = dto.date.slice(0, 10);
    try {
      const { timezone: tz } = await this.getBusinessTimezone(dto.businessId);
      const tBizTz = wallClockMs();
      this.emitPerfPhase({
        event: 'HOLD_PHASE',
        operation,
        requestType: 'hold',
        phase: 'hold_business_timezone',
        phaseMs: tBizTz - t0,
        totalMs: tBizTz - t0,
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        date: dateYmd,
        slotTime: dto.startTime,
      });

      let slotLocal;
      try {
        slotLocal = parseBusinessWallSlotLocal({
          calendarYmd: dateYmd,
          wallHhmm: dto.startTime,
          durationMinutes: dto.durationMinutes,
          timeZone: tz,
        });
      } catch (e) {
        if (e instanceof TimeEngineError) {
          throw new BadRequestException(e.message);
        }
        throw e;
      }

      const timezoneDebug = {
        localStartIso: slotLocal.localStart.toISO(),
        localEndIso: slotLocal.localEnd.toISO(),
        utcStartIso: slotLocal.localStart.toUTC().toISO(),
        utcEndIso: slotLocal.localEnd.toUTC().toISO(),
      };

      const startTime = slotLocal.localStart.toUTC().toJSDate();
      const endTime = slotLocal.localEnd.toUTC().toJSDate();
      requestParsingMs = wallClockMs() - t0;
      this.emitPerfPhase({
        event: 'HOLD_PHASE',
        operation,
        requestType: 'hold',
        phase: 'request_parsing_input_normalization',
        phaseMs: requestParsingMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        date: dateYmd,
        slotTime: slotLocal.wallHhmm,
      });

      const tValidate0 = wallClockMs();
      await this.computedAvailability.validateSlotHoldBusinessRules({
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        dateYmd,
        wallStartHhmm: slotLocal.wallHhmm,
        durationMinutesFromClient: dto.durationMinutes,
        slotStartMinLocal: slotLocal.slotStartMin,
        timezoneDebug,
        resolvedTimeZone: tz,
      });
      const tValidate = wallClockMs();
      preValidationMs = tValidate - tValidate0;
      validationCacheReadMs = this.computedAvailability.getLastValidationCacheReadMs();
      validationRebuildMs = this.computedAvailability.getLastValidationRebuildMs();
      this.emitPerfPhase({
        event: 'HOLD_PHASE',
        operation,
        requestType: 'hold',
        phase: 'pre_validation',
        phaseMs: preValidationMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        date: dateYmd,
        slotTime: slotLocal.wallHhmm,
      });
      this.emitPerfPhase({
        event: 'HOLD_PHASE',
        operation,
        requestType: 'hold',
        phase: 'validation_cache_read',
        phaseMs: validationCacheReadMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        date: dateYmd,
        slotTime: slotLocal.wallHhmm,
        cacheHit: this.computedAvailability.getLastValidationCacheHit(),
        cacheKey: this.computedAvailability.getLastValidationCacheKey() ?? undefined,
      });
      this.emitPerfPhase({
        event: 'HOLD_PHASE',
        operation,
        requestType: 'hold',
        phase: 'validation_rebuild',
        phaseMs: validationRebuildMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        date: dateYmd,
        slotTime: slotLocal.wallHhmm,
        cacheHit: this.computedAvailability.getLastValidationCacheHit(),
        cacheKey: this.computedAvailability.getLastValidationCacheKey() ?? undefined,
      });

      if (this.config.get<string>('LOG_SLOT_HOLD_TIMEZONE_DEBUG') === '1') {
        this.logger.log(
          JSON.stringify({
            type: 'SLOT_HOLD_TIMEZONE_DEBUG',
            calendarYmd: dateYmd,
            slotStartMin: slotLocal.slotStartMin,
            slotEndMin: slotLocal.slotEndMin,
            ...timezoneDebug,
          }),
        );
      }

      slotLockKey = CacheService.keys.slotAttemptLock(
        dto.staffId,
        dateYmd,
        slotLocal.wallHhmm,
      );
      const tLock0 = wallClockMs();
      slotLockToken = await this.cache.tryAcquireShortLock(
        slotLockKey,
        SLOT_ATTEMPT_LOCK_TTL_SEC,
      );
      const slotGateMs = wallClockMs() - tLock0;
      redisMs += slotGateMs;
      this.emitPerfPhase({
        event: 'HOLD_PHASE',
        operation,
        requestType: 'hold',
        phase: 'hold_redis_slot_gate_acquire',
        phaseMs: slotGateMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        date: dateYmd,
        slotTime: slotLocal.wallHhmm,
        cacheHit: !!slotLockToken,
        cacheKey: slotLockKey,
        outcome: slotLockToken ? 'acquired' : 'rejected',
      });
      if (!slotLockToken) {
        this.metrics.incrementSlotHoldConflictAfterAssert(dto.businessId);
        throw new ConflictException({
          code: BOOKING_SLOT_CONFLICT_CODE,
          message: BOOKING_SLOT_CONFLICT_MESSAGE,
          refreshAvailability: true,
        });
      }

      this.metrics.incrementSlotHoldAttemptAfterAssert(dto.businessId);
      const tHold0 = wallClockMs();
      let holdResult;
      try {
        holdResult = await this.slotHolds.createSlotHold({
          businessId: dto.businessId,
          staffId: dto.staffId,
          customerId: dto.customerId,
          serviceId: dto.serviceId,
          userId,
          startTime,
          endTime,
        });
        dbAcquireHoldMs = wallClockMs() - tHold0;
        this.emitPerfPhase({
          event: 'HOLD_PHASE',
          operation,
          requestType: 'hold',
          phase: 'hold_db_acquire_rpc',
          phaseMs: dbAcquireHoldMs,
          totalMs: wallClockMs() - t0,
          businessId: dto.businessId,
          staffId: dto.staffId,
          serviceId: dto.serviceId,
          date: dateYmd,
          slotTime: slotLocal.wallHhmm,
          holdId: holdResult.hold.id,
          outcome: 'created',
        });
      } catch (e: unknown) {
        dbAcquireHoldMs = wallClockMs() - tHold0;
        this.emitPerfPhase({
          event: 'HOLD_PHASE',
          operation,
          requestType: 'hold',
          phase: 'hold_db_acquire_rpc',
          phaseMs: dbAcquireHoldMs,
          totalMs: wallClockMs() - t0,
          businessId: dto.businessId,
          staffId: dto.staffId,
          serviceId: dto.serviceId,
          date: dateYmd,
          slotTime: slotLocal.wallHhmm,
          outcome: 'error',
        });
        if (e instanceof ConflictException) {
          this.metrics.incrementSlotHoldConflictAfterAssert(dto.businessId);
          const agg = this.metrics.getMetrics(dto.businessId)[dto.businessId];
          const resp = e.getResponse();
          const body =
            typeof resp === 'object' && resp !== null ? (resp as Record<string, unknown>) : {};
          const existingCode = typeof body['code'] === 'string' ? body['code'] : null;
          const existingMessage = typeof body['message'] === 'string' ? body['message'] : null;
          if (this.config.get<string>('LOG_AVAILABILITY_HOLD_RACE') !== '0') {
            this.logger.warn(
              JSON.stringify({
                type: 'availability_hold_race',
                detail:
                  existingCode === BOOKING_SLOT_CONFLICT_CODE
                    ? 'POST slot-holds: DB EXCLUDE rejected overlap (appointment or active hold)'
                    : 'POST slot-holds: DB conflict (race or overlapping hold)',
                businessId: dto.businessId,
                staffId: dto.staffId,
                serviceId: dto.serviceId,
                date: dateYmd,
                slot: dto.startTime,
                upstreamCode: existingCode,
                timestamp: new Date().toISOString(),
                availabilityInconsistencyRate: agg?.availabilityInconsistencyRate ?? 0,
                bookingConflictRate: agg?.bookingConflictRate ?? 0,
                acceptableRates: ACCEPTABLE_MONITORING_RATES,
              }),
            );
          }
          void this.hotAvailabilityCache
            .refreshCachedServicesForDay(dto.businessId, dto.staffId, dateYmd)
            .catch((err: unknown) => {
              this.logger.warn(
                `[AvailabilityHotCache] refresh after hold conflict failed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });

          if (process.env.LOG_SLOT_HOLD_PERF === '1') {
            console.log(JSON.stringify({
              type: 'SLOT_HOLD_PERF',
              totalMs: Math.round(wallClockMs() - t0),
              bizTzMs: Math.round(tBizTz - t0),
              validateMs: Math.round(tValidate - tValidate0),
              holdTxMs: Math.round(wallClockMs() - tHold0),
              staffId: dto.staffId,
              slot: dto.startTime,
              outcome: 'conflict',
              conflictCode: existingCode,
            }));
          }

          if (existingCode === BOOKING_SLOT_CONFLICT_CODE) {
            throw new ConflictException({
              code: BOOKING_SLOT_CONFLICT_CODE,
              message: existingMessage ?? BOOKING_SLOT_CONFLICT_MESSAGE,
              refreshAvailability: true,
            });
          }
          throw new ConflictException({
            code: HOLD_SLOT_RACE_CODE,
            message: HOLD_SLOT_RACE_MESSAGE,
            refreshAvailability: true,
          });
        }
        throw e;
      }
      const tHold = wallClockMs();
      resultHoldId = holdResult.hold.id;

      if (this.useTimeSlots) {
        const tTimeSlots0 = wallClockMs();
        await this.timeSlots.holdSlots({
          businessId: dto.businessId,
          staffId: dto.staffId,
          dateYmd,
          startTime: slotLocal.wallHhmm,
          durationMinutes: dto.durationMinutes,
          holdId: holdResult.hold.id,
        }).catch((e) => {
          this.logger.warn(`[TimeSlots] holdSlots failed (non-blocking): ${(e as Error).message}`);
        });
        this.emitPerfPhase({
          event: 'HOLD_PHASE',
          operation,
          requestType: 'hold',
          phase: 'hold_post_write_time_slots',
          phaseMs: wallClockMs() - tTimeSlots0,
          totalMs: wallClockMs() - t0,
          businessId: dto.businessId,
          staffId: dto.staffId,
          serviceId: dto.serviceId,
          date: dateYmd,
          slotTime: slotLocal.wallHhmm,
          holdId: holdResult.hold.id,
        });
      }

      const tRedis0 = wallClockMs();
      await this.availabilityOverlay.upsertHold({
        businessId: dto.businessId,
        staffId: dto.staffId,
        dateYmd,
        holdId: holdResult.hold.id,
        startMin: slotLocal.slotStartMin,
        endMin: slotLocal.slotEndMin,
        expiresAtMs: holdResult.expiresAt.getTime(),
      });
      const overlayMs = wallClockMs() - tRedis0;
      redisMs += overlayMs;
      this.emitPerfPhase({
        event: 'HOLD_PHASE',
        operation,
        requestType: 'hold',
        phase: 'hold_post_write_overlay_update',
        phaseMs: overlayMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        date: dateYmd,
        slotTime: slotLocal.wallHhmm,
        holdId: holdResult.hold.id,
      });
      postHoldInvalidationMs = wallClockMs() - tHold;
      this.emitPerfPhase({
        event: 'HOLD_PHASE',
        operation,
        requestType: 'hold',
        phase: 'post_hold_invalidation',
        phaseMs: postHoldInvalidationMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        date: dateYmd,
        slotTime: slotLocal.wallHhmm,
        holdId: holdResult.hold.id,
      });
      this.emitPerfPhase({
        event: 'HOLD_PHASE',
        operation,
        requestType: 'hold',
        phase: 'redis_cache_operations',
        phaseMs: redisMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        date: dateYmd,
        slotTime: slotLocal.wallHhmm,
        holdId: holdResult.hold.id,
      });

      if (process.env.LOG_SLOT_HOLD_PERF === '1') {
        console.log(JSON.stringify({
          type: 'SLOT_HOLD_PERF',
          totalMs: Math.round(wallClockMs() - t0),
          bizTzMs: Math.round(tBizTz - t0),
          validateMs: Math.round(tValidate - tValidate0),
          holdTxMs: Math.round(tHold - tHold0),
          bustCacheMs: Math.round(wallClockMs() - tHold),
          staffId: dto.staffId,
          slot: dto.startTime,
          outcome: 'created',
          useTimeSlots: this.useTimeSlots,
        }));
      }

      const serializationMs = this.measureSerializationMs(holdResult);
      statusCode = 201;
      resultType = 'success';
      this.emitPerfPhase({
        event: 'HOLD_PHASE',
        operation,
        requestType: 'hold',
        phase: 'response_serialization',
        phaseMs: serializationMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        date: dateYmd,
        slotTime: slotLocal.wallHhmm,
        holdId: holdResult.hold.id,
        statusCode,
        resultType,
      });
      return holdResult;
    } catch (e: unknown) {
      if (e instanceof ConflictException) {
        statusCode = 409;
        resultType = 'conflict';
      } else {
        const status =
          typeof (e as { getStatus?: () => number })?.getStatus === 'function'
            ? (e as { getStatus: () => number }).getStatus()
            : undefined;
        statusCode = typeof status === 'number' ? status : 500;
        resultType = statusCode === 409 ? 'conflict' : 'error';
      }
      const body =
        typeof (e as { getResponse?: () => unknown })?.getResponse === 'function'
          ? (e as { getResponse: () => unknown }).getResponse()
          : undefined;
      if (body && typeof body === 'object') {
        const rec = body as Record<string, unknown>;
        if (typeof rec.code === 'string') {
          if (resultType === 'conflict') conflictCode = rec.code;
          else errorCode = rec.code;
        }
      }
      throw e;
    } finally {
      if (slotLockKey && slotLockToken) {
        const tUnlock0 = wallClockMs();
        await this.cache.releaseShortLock(slotLockKey, slotLockToken);
        const unlockMs = wallClockMs() - tUnlock0;
        redisMs += unlockMs;
        this.emitPerfPhase({
          event: 'HOLD_PHASE',
          operation,
          requestType: 'hold',
          phase: 'hold_redis_slot_gate_release',
          phaseMs: unlockMs,
          totalMs: wallClockMs() - t0,
          businessId: dto.businessId,
          staffId: dto.staffId,
          serviceId: dto.serviceId,
          holdId: resultHoldId,
          cacheKey: slotLockKey,
          statusCode,
          resultType,
          conflictCode,
          errorCode,
        });
      }
      this.emitPerfPhase({
        event: 'HOLD_PHASE',
        operation,
        requestType: 'hold',
        phase: 'total',
        phaseMs: wallClockMs() - t0,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        date: dateYmd,
        holdId: resultHoldId,
        slotTime: dto.startTime,
        statusCode,
        resultType,
        conflictCode,
        errorCode,
      });
      this.emitFlowTiming({
        step: 'hold',
        validationMs: preValidationMs,
        dbMs: dbAcquireHoldMs,
        redisMs,
        totalMs: wallClockMs() - t0,
      });
      this.emitWritePathStageProfile({
        flow: 'slot_hold',
        operation,
        businessId: dto.businessId,
        statusCode,
        resultType,
        validationMs: preValidationMs,
        dbMs: dbAcquireHoldMs,
        transactionMs: dbAcquireHoldMs,
        totalMs: wallClockMs() - t0,
        holdId: resultHoldId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        conflictCode,
        errorCode,
      });
    }
  }

  /**
   * Admin: finalize booking from a live hold (staff may confirm holds created for any user).
   */
  async createAppointment(dto: CreateAppointmentDto) {
    const timing = this.createAppointmentCreateTimingState();
    resetPrismaQueryDurationMs();
    startAppointmentCreateTrace();
    setAppointmentCreateTracePhase('create_appointment_entry');
    const requestId = getRequestId();

    try {
      const appointment = await this.confirmBookingFromHold(dto, {
        operation: 'POST /appointments/create',
        createTiming: timing,
      });
      return appointment;
    } finally {
      const totalMs = Math.round(wallClockMs() - timing.requestStartMs);
      const prisma = this.buildCreatePrismaDiagnostics();
      const projectionRegeneratedDuringCreate =
        timing.projectionRegeneratedDuringCreate ||
        prisma.projectionRegeneratedDuringCreate;

      this.logger.log(
        JSON.stringify({
          type: 'APPOINTMENT_CREATE_TIMING',
          requestId,
          businessId: dto.businessId,
          staffId: timing.staffId ?? null,
          serviceId: timing.serviceId ?? null,
          customerId: timing.customerId ?? null,
          totalMs,
          authMs: Math.round(timing.authMs),
          dtoValidationMs: Math.round(timing.dtoValidationMs),
          customerLoadMs: Math.round(timing.customerLoadMs),
          staffLoadMs: Math.round(timing.staffLoadMs),
          serviceLoadMs: Math.round(timing.serviceLoadMs),
          staffServiceValidationMs: Math.round(timing.staffServiceValidationMs),
          slotHoldValidationMs: Math.round(timing.slotHoldValidationMs),
          availabilityValidationMs: Math.round(timing.availabilityValidationMs),
          timeSlotUpdateMs: Math.round(timing.timeSlotUpdateMs),
          transactionMs: Math.round(timing.transactionMs),
          appointmentInsertMs: Math.round(timing.appointmentInsertMs),
          cacheInvalidationMs: Math.round(timing.cacheInvalidationMs),
          projectionSyncMs: Math.round(timing.projectionSyncMs),
          notificationMs: Math.round(timing.notificationMs),
          analyticsMs: Math.round(timing.analyticsMs),
          responseBuildMs: Math.round(timing.responseBuildMs),
          serializationMs: Math.round(timing.serializationMs),
          prismaQueryCount: prisma.prismaQueryCount,
          prismaTotalMs: prisma.prismaTotalMs,
          slowQueries: prisma.slowQueries,
          repeatedQueries: prisma.repeatedQueries,
          projectionRegeneratedDuringCreate,
          notificationsAwaitedInsideCreate: timing.notificationsAwaitedInsideCreate,
          invalidatedKeyCount: timing.invalidatedKeyCount,
          invalidationPatterns: timing.invalidationPatterns,
          queryTrace: getAppointmentCreateTraceEntries(),
        }),
      );

      this.logger.log(
        JSON.stringify({
          type: 'APPOINTMENT_CREATE_TX_TIMING',
          requestId,
          txTotalMs: Math.round(timing.txTotalMs),
          holdLockMs: Math.round(timing.holdLockMs),
          overlapCheckMs: Math.round(timing.overlapCheckMs),
          appointmentInsertMs: Math.round(timing.appointmentInsertMs),
          timeSlotBlockMs: Math.round(timing.timeSlotUpdateMs),
          slotHoldConsumeMs: Math.round(timing.slotHoldConsumeMs),
          commitMs: Math.round(timing.commitMs),
        }),
      );
      if (totalMs >= 1500 || timing.transactionMs >= 1200) {
        try {
          const waitDiagnostics = await this.sampleDbWaitDiagnostics();
          this.logger.log(
            JSON.stringify({
              type: 'APPOINTMENT_CREATE_DB_WAIT_DIAGNOSTICS',
              requestId,
              businessId: dto.businessId,
              totalMs,
              transactionMs: Math.round(timing.transactionMs),
              ...waitDiagnostics,
            }),
          );
        } catch (error) {
          this.logger.warn(
            `[APPOINTMENT_CREATE_DB_WAIT_DIAGNOSTICS] failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      stopAppointmentCreateTrace();
    }
  }

  /**
   * Public book endpoint: same atomic confirm; optional `requireHoldOwnerUserId` enforces hold.userId (customers).
   */
  async bookAppointment(dto: BookAppointmentDto, requireHoldOwnerUserId?: string) {
    return this.confirmBookingFromHold(dto, {
      requireHoldOwnerUserId,
      operation: 'POST /appointments/book',
    });
  }

  /**
   * Atomic: lock hold → validate → optional idempotency replay → insert appointment → mark hold consumed.
   * No availability / fragmentation / application overlap prediction — DB constraints are authoritative.
   * EXCLUDE / unique failures → HTTP 409 {@link BOOKING_SLOT_CONFLICT_CODE}.
   */
  async confirmBookingFromHold(
    dto: ConfirmBookingFromHoldDto,
    opts?: {
      requireHoldOwnerUserId?: string;
      operation?: 'POST /appointments/book' | 'POST /appointments/create';
      createTiming?: AppointmentCreateTimingState;
    },
  ) {
    this.metrics.incrementBookingAttempt(dto.businessId);

    type Row = Prisma.AppointmentGetPayload<{ select: typeof BookingService.appointmentInsertSelect }>;

    const t0 = wallClockMs();
    const operation = opts?.operation ?? 'POST /appointments/book';
    const createTiming = opts?.createTiming;
    let requestParsingMs = 0;
    let txStartedAt = 0;
    let preTransactionMs = 0;
    let dbTransactionMs = 0;
    let postTransactionSideEffectsMs = 0;
    let postBookingCacheInvalidationMs = 0;
    let txCallbackMs = 0;
    let txHoldLockMs = 0;
    let txOverlapCheckMs = 0;
    let txAppointmentInsertMs = 0;
    let txTimeSlotBlockMs = 0;
    let txSlotHoldConsumeMs = 0;
    let appointment: Row | undefined;
    let confirmTz: string | undefined;
    let bookingInserted = false;
    let replayedFromIdempotency = false;
    let statusCode = 500;
    let resultType: 'success' | 'conflict' | 'error' = 'error';
    let conflictCode: string | undefined;
    let errorCode: string | undefined;
    try {
      try {
        const perfLog = process.env.LOG_BOOKING_CONFIRM_PERF === '1';
        requestParsingMs = wallClockMs() - t0;
        this.emitPerfPhase({
          event: 'BOOK_PHASE',
          operation,
          requestType: 'book',
          phase: 'request_parsing_input_normalization',
          phaseMs: requestParsingMs,
          totalMs: wallClockMs() - t0,
          businessId: dto.businessId,
          holdId: dto.slotHoldId,
        });
        if (dto.idempotencyKey) {
          const tIdempotency0 = wallClockMs();
          const existing = await this.prisma.appointment.findFirst({
            where: {
              businessId: dto.businessId,
              idempotencyKey: dto.idempotencyKey,
            },
            select: BookingService.appointmentInsertSelect,
          });
          const idempotencyReadMs = wallClockMs() - tIdempotency0;
          this.emitPerfPhase({
            event: 'BOOK_PHASE',
            operation,
            requestType: 'book',
            phase: 'idempotency_precheck',
            phaseMs: idempotencyReadMs,
            totalMs: wallClockMs() - t0,
            businessId: dto.businessId,
            holdId: dto.slotHoldId,
            cacheHit: !!existing,
            outcome: existing ? 'replay' : 'miss',
          });
          if (existing) {
            appointment = existing;
            replayedFromIdempotency = true;
          }
        }
        ({ timezone: confirmTz } = await this.getBusinessTimezone(dto.businessId));
        const tz = confirmTz;
      if (!replayedFromIdempotency) {
          createTiming && setAppointmentCreateTracePhase('transaction_begin');
          const tTx0 = wallClockMs();
          txStartedAt = tTx0;
          preTransactionMs = tTx0 - t0;
          this.emitPerfPhase({
            event: 'BOOK_PHASE',
            operation,
            requestType: 'book',
            phase: 'pre_transaction_work',
            phaseMs: preTransactionMs,
            totalMs: tTx0 - t0,
            businessId: dto.businessId,
            holdId: dto.slotHoldId,
          });
          const updateTimeSlotsInBookTx = this.useTimeSlots;

          appointment = await this.prisma.$transaction(
            async (tx) => {
              createTiming && setAppointmentCreateTraceInsideTransaction(true);
              const txCallbackStart = wallClockMs();
              const now = utcNowJsDate();

              createTiming && setAppointmentCreateTracePhase('tx_hold_lock');
              const [hold] = await tx.$queryRaw<Array<{
                id: string;
                businessId: string;
                staffId: string;
                customerId: string;
                serviceId: string;
                startTime: Date;
                endTime: Date;
                userId: string;
                expiresAt: Date;
                consumedAt: Date | null;
              }>>`
                SELECT id,
                       business_id AS "businessId",
                       staff_id    AS "staffId",
                       customer_id AS "customerId",
                       service_id  AS "serviceId",
                       start_time  AS "startTime",
                       end_time    AS "endTime",
                       user_id     AS "userId",
                       expires_at  AS "expiresAt",
                       consumed_at AS "consumedAt"
                FROM slot_holds
                WHERE id = ${dto.slotHoldId}::text
                FOR UPDATE
              `;
              const tLock = wallClockMs();
              const tHoldRead = tLock;
              txHoldLockMs += tLock - tTx0;

              if (!hold) {
                txCallbackMs += wallClockMs() - txCallbackStart;
                throw new NotFoundException({
                  code: HOLD_NOT_FOUND,
                  message: 'Slot hold not found.',
                });
              }
              if (hold.businessId !== dto.businessId) {
                txCallbackMs += wallClockMs() - txCallbackStart;
                throw new ForbiddenException({
                  code: HOLD_BUSINESS_MISMATCH,
                  message: 'Hold does not belong to this business.',
                });
              }

              if (opts?.requireHoldOwnerUserId && hold.userId !== opts.requireHoldOwnerUserId) {
                txCallbackMs += wallClockMs() - txCallbackStart;
                throw new ForbiddenException({
                  code: HOLD_FORBIDDEN,
                  message: 'This hold was created by another user.',
                });
              }

              if (hold.consumedAt != null) {
                txCallbackMs += wallClockMs() - txCallbackStart;
                throw new ConflictException({
                  code: HOLD_ALREADY_USED,
                  message: 'This slot hold was already used.',
                });
              }

              if (hold.expiresAt <= now) {
                txCallbackMs += wallClockMs() - txCallbackStart;
                throw new BadRequestException({
                  code: HOLD_EXPIRED,
                  message: 'Slot hold has expired.',
                });
              }
              const tHoldValidationDone = wallClockMs();
              createTiming && (createTiming.slotHoldValidationMs += tHoldValidationDone - tHoldRead);
              createTiming && (createTiming.staffId = hold.staffId);
              createTiming && (createTiming.serviceId = hold.serviceId);
              createTiming && (createTiming.customerId = hold.customerId);

              const tOverlap = wallClockMs();
              createTiming && setAppointmentCreateTracePhase('tx_overlap_check');
              const tBizTz = tOverlap;
              const dateYmd = formatBusinessTime(hold.startTime, tz, 'yyyy-MM-dd');
              const startHhmm = formatBusinessTime(hold.startTime, tz, 'HH:mm');
              const slotKey = `${hold.businessId}:${hold.staffId}:${dateYmd}:${startHhmm}`;
              const businessSettingsRow = await tx.business.findUnique({
                where: { id: hold.businessId },
                select: { settings: true },
              });
              const requireCustomerArrivalConfirmation =
                (
                  (businessSettingsRow?.settings as {
                    generalSettings?: { requireCustomerArrivalConfirmation?: boolean };
                  } | null)?.generalSettings?.requireCustomerArrivalConfirmation
                ) === true;
              txOverlapCheckMs += wallClockMs() - tOverlap;

              await tx.$executeRawUnsafe('SAVEPOINT booking_confirm_appt');
              try {
                createTiming && setAppointmentCreateTracePhase('tx_appointment_insert');
                const tInsertStart = wallClockMs();
                const created = await tx.appointment.create({
                  data: {
                    businessId: hold.businessId,
                    branchId: dto.branchId ?? null,
                    locationId: dto.locationId ?? null,
                    customerId: hold.customerId,
                    staffId: hold.staffId,
                    serviceId: hold.serviceId,
                    startTime: hold.startTime,
                    endTime: hold.endTime,
                    status: 'CONFIRMED',
                    slotKey,
                    notes: dto.notes ?? null,
                    slotHoldId: hold.id,
                    idempotencyKey: dto.idempotencyKey ?? null,
                  },
                  select: BookingService.appointmentInsertSelect,
                });
                txAppointmentInsertMs += wallClockMs() - tInsertStart;
                try {
                  await tx.$executeRaw`
                    UPDATE appointments
                    SET "confirmationStatus" = ${
                      requireCustomerArrivalConfirmation ? 'PENDING' : 'NOT_REQUIRED'
                    }::"AppointmentConfirmationStatus"
                    WHERE id = ${created.id}
                  `;
                } catch {
                  // Backward-compatible deployment: ignore until migration is applied.
                }

                if (updateTimeSlotsInBookTx) {
                  createTiming && setAppointmentCreateTracePhase('tx_time_slot_block');
                  const tTimeSlotsStart = wallClockMs();
                  await this.timeSlots.bookSlotsInTransaction(
                    tx,
                    dto.slotHoldId,
                    created.id,
                  );
                  txTimeSlotBlockMs += wallClockMs() - tTimeSlotsStart;
                }

                const tConsumeStart = wallClockMs();
                createTiming && setAppointmentCreateTracePhase('tx_slot_hold_consume');
                await tx.slotHold.update({
                  where: { id: hold.id },
                  data: { consumedAt: now },
                });
                txSlotHoldConsumeMs += wallClockMs() - tConsumeStart;

                await tx.$executeRawUnsafe('RELEASE SAVEPOINT booking_confirm_appt');
                createTiming && setAppointmentCreateTracePhase('tx_commit_release_savepoint');
                bookingInserted = true;

                if (perfLog) {
                  const tInsert = wallClockMs();
                  console.log(JSON.stringify({
                    type: 'BOOKING_CONFIRM_PERF',
                    lockMs: Math.round(tLock - tTx0),
                    holdReadMs: Math.round(tHoldRead - tLock),
                    overlapCheckMs: Math.round(tOverlap - tHoldRead),
                    bizTzMs: Math.round(tBizTz - tOverlap),
                    insertConsumeMs: Math.round(tInsert - tBizTz),
                    totalTxMs: Math.round(tInsert - tTx0),
                    slotHoldId: dto.slotHoldId,
                  }));
                }

                txCallbackMs += wallClockMs() - txCallbackStart;

                return created;
              } catch (e: unknown) {
                createTiming && setAppointmentCreateTracePhase('tx_error_rollback_savepoint');
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT booking_confirm_appt');
                txCallbackMs += wallClockMs() - txCallbackStart;
                if (isTransientInsertFailure(e)) {
                  throw e;
                }
                if (isPrismaUniqueViolation(e) || isPrismaExclusion23P01(e)) {
                  this.metrics.incrementBookingConflict(dto.businessId);
                  throw new ConflictException({
                    code: BOOKING_SLOT_CONFLICT_CODE,
                    message: BOOKING_SLOT_CONFLICT_MESSAGE,
                    refreshAvailability: true,
                  });
                }
                const prisma = getPrismaErrorDiagnostics(e);
                this.logger.error('[Booking] confirmBookingFromHold failed', {
                  code: prisma.prismaCode,
                  slotHoldId: dto.slotHoldId,
                  businessId: dto.businessId,
                });
                throw e;
              }
            },
            getBookingAtomicBookTxOptions(),
          );
          createTiming && setAppointmentCreateTraceInsideTransaction(false);
          createTiming && setAppointmentCreateTracePhase('transaction_end');
          dbTransactionMs = wallClockMs() - tTx0;
          if (createTiming) {
            createTiming.transactionMs += dbTransactionMs;
            createTiming.txTotalMs += dbTransactionMs;
            createTiming.holdLockMs += txHoldLockMs;
            createTiming.overlapCheckMs += txOverlapCheckMs;
            createTiming.appointmentInsertMs += txAppointmentInsertMs;
            createTiming.timeSlotUpdateMs += txTimeSlotBlockMs;
            createTiming.slotHoldConsumeMs += txSlotHoldConsumeMs;
            createTiming.commitMs += Math.max(0, dbTransactionMs - txCallbackMs);
          }
          this.emitPerfPhase({
            event: 'BOOK_PHASE',
            operation,
            requestType: 'book',
            phase: 'transaction_body',
            phaseMs: dbTransactionMs,
            totalMs: wallClockMs() - t0,
            businessId: dto.businessId,
            staffId: appointment.staffId,
            bookingId: appointment.id,
            holdId: dto.slotHoldId,
            serviceId: appointment.serviceId,
            statusCode: 200,
            resultType: 'success',
            outcome: 'success',
          });
        }
      } catch (e: unknown) {
        createTiming && setAppointmentCreateTraceInsideTransaction(false);
        createTiming && setAppointmentCreateTracePhase('transaction_error');
        if (txStartedAt > 0 && dbTransactionMs === 0) {
          dbTransactionMs = wallClockMs() - txStartedAt;
          this.emitPerfPhase({
            event: 'BOOK_PHASE',
            operation,
            requestType: 'book',
            phase: 'transaction_body',
            phaseMs: dbTransactionMs,
            totalMs: wallClockMs() - t0,
            businessId: dto.businessId,
            holdId: dto.slotHoldId,
            statusCode: 409,
            resultType: 'conflict',
            outcome: 'error',
          });
        }
        if (
          dto.idempotencyKey &&
          isPrismaUniqueViolation(e) &&
          !isPrismaUniqueViolationOnAppointmentSlotKey(e)
        ) {
          const replay = await this.prisma.appointment.findFirst({
            where: {
              businessId: dto.businessId,
              idempotencyKey: dto.idempotencyKey,
            },
            select: BookingService.appointmentInsertSelect,
          });
          if (replay) {
            appointment = replay;
            replayedFromIdempotency = true;
          } else {
            throw e;
          }
        } else if (isBookingFinalConflictError(e)) {
          this.metrics.incrementBookingConflict(dto.businessId);
          const { prismaCode, errorChain } = getPrismaErrorDiagnostics(e);
          statusCode = 409;
          resultType = 'conflict';
          conflictCode = BOOKING_SLOT_CONFLICT_CODE;
          this.logger.warn('[Booking] confirmBookingFromHold → CONFLICT (exclusion / unique)', {
            slotHoldId: dto.slotHoldId,
            businessId: dto.businessId,
            prismaCode,
            errorChain: errorChain.slice(0, 800),
          });
          throw new ConflictException({
            code: BOOKING_SLOT_CONFLICT_CODE,
            message: BOOKING_SLOT_CONFLICT_MESSAGE,
          });
        } else {
          const body =
            typeof (e as { getResponse?: () => unknown })?.getResponse === 'function'
              ? (e as { getResponse: () => unknown }).getResponse()
              : undefined;
          if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).code === 'string') {
            errorCode = (body as Record<string, unknown>).code as string;
          }
          throw e;
        }
      }

      const postInsertPerf: {
        cacheMs: number;
        sideEffectsMs: number;
        notificationMs?: number;
        analyticsMs?: number;
        projectionSyncMs?: number;
        notificationsAwaitedInsideRequest?: boolean;
        invalidatedKeyCount?: number;
        invalidationPatterns?: string[];
      } = { cacheMs: 0, sideEffectsMs: 0 };
      if (bookingInserted) {
        const bookingDateYmd =
          confirmTz != null
            ? formatBusinessTime(appointment!.startTime, confirmTz, 'yyyy-MM-dd')
            : null;
        const bookingStartHhmm =
          confirmTz != null
            ? formatBusinessTime(appointment!.startTime, confirmTz, 'HH:mm')
            : null;
        const bookingEndHhmm =
          confirmTz != null
            ? formatBusinessTime(appointment!.endTime, confirmTz, 'HH:mm')
            : null;
        if (bookingDateYmd && bookingStartHhmm && bookingEndHhmm) {
          void this.markDirtyWindows({
            businessId: dto.businessId,
            windows: [
              {
                staffId: appointment!.staffId,
                dateYmd: bookingDateYmd,
                startMin: hhmmToMinutes(bookingStartHhmm),
                endMin: hhmmToMinutes(bookingEndHhmm),
              },
            ],
          }).catch((e) =>
            this.logger.warn(
              `[BookingDirtyWindow] mark failed: ${
                e instanceof Error ? e.message : String(e)
              }`,
            ),
          );
        }
        await this.afterBookingInsert(
          appointment as Row,
          appointment!.id,
          appointment!.startTime,
          postInsertPerf,
          confirmTz,
        );
        postTransactionSideEffectsMs = postInsertPerf.sideEffectsMs;
        postBookingCacheInvalidationMs = postInsertPerf.cacheMs;
        if (createTiming) {
          createTiming.cacheInvalidationMs += postInsertPerf.cacheMs;
          createTiming.notificationMs += postInsertPerf.notificationMs ?? 0;
          createTiming.analyticsMs += postInsertPerf.analyticsMs ?? 0;
          createTiming.projectionSyncMs += postInsertPerf.projectionSyncMs ?? 0;
          createTiming.notificationsAwaitedInsideCreate =
            createTiming.notificationsAwaitedInsideCreate ||
            !!postInsertPerf.notificationsAwaitedInsideRequest;
          createTiming.invalidatedKeyCount += postInsertPerf.invalidatedKeyCount ?? 0;
          const patterns = postInsertPerf.invalidationPatterns ?? [];
          if (patterns.length > 0) {
            createTiming.invalidationPatterns.push(...patterns);
          }
        }
        this.emitPerfPhase({
          event: 'BOOK_PHASE',
          operation,
          requestType: 'book',
          phase: 'post_transaction_side_effects',
          phaseMs: postTransactionSideEffectsMs,
          totalMs: wallClockMs() - t0,
          businessId: dto.businessId,
          staffId: appointment!.staffId,
          bookingId: appointment!.id,
          holdId: appointment!.slotHoldId ?? dto.slotHoldId,
          serviceId: appointment!.serviceId,
        });
        this.emitPerfPhase({
          event: 'BOOK_PHASE',
          operation,
          requestType: 'book',
          phase: 'post_booking_cache_invalidation',
          phaseMs: postBookingCacheInvalidationMs,
          totalMs: wallClockMs() - t0,
          businessId: dto.businessId,
          staffId: appointment!.staffId,
          bookingId: appointment!.id,
          holdId: appointment!.slotHoldId ?? dto.slotHoldId,
          serviceId: appointment!.serviceId,
          date:
            confirmTz != null
              ? formatBusinessTime(appointment!.startTime, confirmTz, 'yyyy-MM-dd')
              : undefined,
        });
      }
      if (!appointment) {
        throw new NotFoundException('Appointment not found after booking confirmation');
      }
      const serializationMs = this.measureSerializationMs(appointment);
      if (createTiming) {
        createTiming.responseBuildMs += serializationMs;
        createTiming.serializationMs += serializationMs;
      }
      statusCode = 201;
      resultType = 'success';
      this.emitPerfPhase({
        event: 'BOOK_PHASE',
        operation,
        requestType: 'book',
        phase: 'response_serialization',
        phaseMs: serializationMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: appointment.staffId,
        bookingId: appointment.id,
        holdId: appointment.slotHoldId ?? dto.slotHoldId,
        serviceId: appointment.serviceId,
        statusCode,
        resultType,
      });
      return appointment;
    } catch (e: unknown) {
      if (e instanceof ConflictException) {
        statusCode = 409;
        resultType = 'conflict';
      } else {
        const status =
          typeof (e as { getStatus?: () => number })?.getStatus === 'function'
            ? (e as { getStatus: () => number }).getStatus()
            : undefined;
        statusCode = typeof status === 'number' ? status : 500;
        resultType = statusCode === 409 ? 'conflict' : 'error';
      }
      const body =
        typeof (e as { getResponse?: () => unknown })?.getResponse === 'function'
          ? (e as { getResponse: () => unknown }).getResponse()
          : undefined;
      if (body && typeof body === 'object') {
        const rec = body as Record<string, unknown>;
        if (typeof rec.code === 'string') {
          if (resultType === 'conflict') conflictCode = rec.code;
          else errorCode = rec.code;
        }
      }
      throw e;
    } finally {
      this.emitPerfPhase({
        event: 'BOOK_PHASE',
        operation,
        requestType: 'book',
        phase: 'total',
        phaseMs: wallClockMs() - t0,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: appointment?.staffId,
        bookingId: appointment?.id,
        holdId: appointment?.slotHoldId ?? dto.slotHoldId,
        serviceId: appointment?.serviceId,
        statusCode,
        resultType,
        conflictCode,
        errorCode,
      });
      this.emitFlowTiming({
        step: 'book',
        dbMs: dbTransactionMs,
        redisMs: postBookingCacheInvalidationMs,
        totalMs: wallClockMs() - t0,
      });
      this.emitWritePathStageProfile({
        flow: 'booking',
        operation,
        businessId: dto.businessId,
        statusCode,
        resultType,
        dbMs: dbTransactionMs,
        transactionMs: dbTransactionMs,
        totalMs: wallClockMs() - t0,
        holdId: appointment?.slotHoldId ?? dto.slotHoldId,
        appointmentId: appointment?.id,
        staffId: appointment?.staffId,
        serviceId: appointment?.serviceId,
        conflictCode,
        errorCode,
      });
    }
  }

  private async afterBookingInsert(
    row: {
      businessId: string;
      customerId: string;
      staffId: string;
      startTime: Date;
      endTime: Date;
      slotHoldId: string | null;
    },
    appointmentId: string,
    startTimeUtc: Date,
    perf?: {
      cacheMs: number;
      sideEffectsMs: number;
      notificationMs?: number;
      analyticsMs?: number;
      projectionSyncMs?: number;
      notificationsAwaitedInsideRequest?: boolean;
      invalidatedKeyCount?: number;
      invalidationPatterns?: string[];
    },
    preloadedTimeZone?: string,
  ): Promise<void> {
    const tz = preloadedTimeZone ?? (await this.getBusinessTimezone(row.businessId)).timezone;
    const dateYmd = formatBusinessTime(row.startTime, tz, 'yyyy-MM-dd');
    const startHhmm = formatBusinessTime(row.startTime, tz, 'HH:mm');
    const endHhmm = formatBusinessTime(row.endTime, tz, 'HH:mm');

    const tSideEffects0 = wallClockMs();
    const tNotification0 = wallClockMs();
    this.notifications
      .notifyAppointmentBooked({
        businessId: row.businessId,
        customerId: row.customerId,
        appointmentId,
        customerName: 'Customer',
        serviceName: 'Appointment',
        date: dateYmd,
        startTime: startHhmm,
        phone: undefined,
        email: undefined,
      })
      .catch((e: unknown) => console.error('[Booking] notifyAppointmentBooked failed:', e));

    this.arrivalConfirmation
      .sendIfEnabled(appointmentId)
      .catch((e: unknown) => console.error('[Booking] arrivalConfirmation failed:', e));

    this.automation
      .scheduleAppointmentReminder(appointmentId, row.businessId, startTimeUtc)
      .catch((e: unknown) => console.error('[Booking] scheduleAppointmentReminder failed:', e));
    if (perf) {
      perf.notificationMs = (perf.notificationMs ?? 0) + (wallClockMs() - tNotification0);
      perf.notificationsAwaitedInsideRequest = false;
    }

    const tAnalytics0 = wallClockMs();
    this.metrics.incrementBookingSuccess(row.businessId);
    if (perf) {
      perf.analyticsMs = (perf.analyticsMs ?? 0) + (wallClockMs() - tAnalytics0);
      perf.projectionSyncMs = perf.projectionSyncMs ?? 0;
      perf.invalidatedKeyCount = perf.invalidatedKeyCount ?? 0;
      perf.invalidationPatterns = perf.invalidationPatterns ?? [];
    }
    if (perf) {
      perf.sideEffectsMs += wallClockMs() - tSideEffects0;
    }
    const tRedis0 = wallClockMs();
    const overlayOps: Promise<void>[] = [
      this.availabilityOverlay.upsertBooked({
        businessId: row.businessId,
        staffId: row.staffId,
        dateYmd: dateYmd.slice(0, 10),
        appointmentId,
        startMin: hhmmToMinutes(startHhmm),
        endMin: hhmmToMinutes(endHhmm),
      }),
    ];
    if (row.slotHoldId) {
      overlayOps.push(
        this.availabilityOverlay.removeHold({
          businessId: row.businessId,
          staffId: row.staffId,
          dateYmd: dateYmd.slice(0, 10),
          holdId: row.slotHoldId,
        }),
      );
    }
    await Promise.all(overlayOps);
    if (perf) {
      perf.cacheMs += wallClockMs() - tRedis0;
    }
  }

  /**
   * Cancel an appointment.
   */
  async cancelAppointment(
    appointmentId: string,
    businessId: string,
    reason?: string,
  ) {
    const t0 = wallClockMs();
    const operation = 'POST /appointments/cancel';
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }
    if (appointment.businessId !== businessId) {
      throw new ForbiddenException('Appointment does not belong to this business');
    }
    if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(appointment.status)) {
      throw new BadRequestException(
        `Cannot cancel appointment with status ${appointment.status}`,
      );
    }

    const tUpdate0 = wallClockMs();
    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'CANCELLED',
        cancelledAt: utcNowJsDate(),
        cancellationReason: reason,
      },
      include: {
        staff: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
    });
    this.emitPerfPhase({
      event: 'CANCEL_PHASE',
      operation,
      requestType: 'cancel',
      phase: 'transaction_update',
      phaseMs: wallClockMs() - tUpdate0,
      totalMs: wallClockMs() - t0,
      businessId,
      staffId: appointment.staffId,
      bookingId: appointmentId,
    });

    const dateStr = updated.startTime.toISOString().slice(0, 10);
    const startTime = updated.startTime.toISOString().slice(11, 16);
    const customerName =
      updated.customer.firstName ?? updated.customer.lastName ?? 'Customer';
    this.notifications
      .notifyAppointmentCancelled({
        businessId: updated.businessId,
        customerName,
        serviceName: updated.service.name,
        date: dateStr,
        startTime,
      })
      .catch((e: unknown) => console.warn('[Booking] notifyAppointmentCancelled failed:', e));

    this.customerVisits
      .createFromAppointment(
        appointmentId,
        'CANCELLED',
        0,
      )
      .catch((e) => console.error('[Booking] createFromAppointment failed:', e));

    if (this.useTimeSlots) {
      const tCancelSlots0 = wallClockMs();
      await this.timeSlots.cancelBooking(appointmentId).catch((e) => {
        this.logger.warn(`[TimeSlots] cancelBooking failed (non-blocking): ${(e as Error).message}`);
      });
      this.emitPerfPhase({
        event: 'CANCEL_PHASE',
        requestType: 'cancel',
        phase: 'cancel_time_slots_release',
        phaseMs: wallClockMs() - tCancelSlots0,
        totalMs: wallClockMs() - t0,
        businessId,
        staffId: appointment.staffId,
      });
    }

    const { timezone: cancelTz } = await this.getBusinessTimezone(updated.businessId);
    const cancelDateYmd = formatBusinessTime(updated.startTime, cancelTz, 'yyyy-MM-dd');
    const cancelStartHhmm = formatBusinessTime(updated.startTime, cancelTz, 'HH:mm');
    const cancelEndHhmm = formatBusinessTime(updated.endTime, cancelTz, 'HH:mm');
    void this.markDirtyWindows({
      businessId: updated.businessId,
      windows: [
        {
          staffId: appointment.staffId,
          dateYmd: cancelDateYmd,
          startMin: hhmmToMinutes(cancelStartHhmm),
          endMin: hhmmToMinutes(cancelEndHhmm),
        },
      ],
    }).catch((e) =>
      this.logger.warn(
        `[CancelDirtyWindow] mark failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
    const tInvalidation0 = wallClockMs();
    const tOverlay0 = wallClockMs();
    await this.availabilityOverlay.removeBooked({
      businessId: updated.businessId,
      staffId: appointment.staffId,
      dateYmd: cancelDateYmd,
      appointmentId,
    });
    this.emitPerfPhase({
      event: 'CANCEL_PHASE',
      operation,
      requestType: 'cancel',
      phase: 'cancel_overlay_update',
      phaseMs: wallClockMs() - tOverlay0,
      totalMs: wallClockMs() - t0,
      businessId,
      staffId: appointment.staffId,
      bookingId: appointmentId,
      date: cancelDateYmd,
    });
    const tHotRefresh0 = wallClockMs();
    await this.hotAvailabilityCache.refreshCachedServicesForDay(
      updated.businessId,
      appointment.staffId,
      cancelDateYmd,
    );
    this.emitPerfPhase({
      event: 'CANCEL_PHASE',
      operation,
      requestType: 'cancel',
      phase: 'cancel_hot_cache_refresh',
      phaseMs: wallClockMs() - tHotRefresh0,
      totalMs: wallClockMs() - t0,
      businessId,
      staffId: appointment.staffId,
      bookingId: appointmentId,
      date: cancelDateYmd,
    });
    this.emitPerfPhase({
      event: 'CANCEL_PHASE',
      operation,
      requestType: 'cancel',
      phase: 'post_cancel_invalidation',
      phaseMs: wallClockMs() - tInvalidation0,
      totalMs: wallClockMs() - t0,
      businessId,
      staffId: appointment.staffId,
      bookingId: appointmentId,
      date: cancelDateYmd,
    });
    this.emitPerfPhase({
      event: 'CANCEL_PHASE',
      operation,
      requestType: 'cancel',
      phase: 'total',
      phaseMs: wallClockMs() - t0,
      totalMs: wallClockMs() - t0,
      businessId,
      staffId: appointment.staffId,
      bookingId: appointmentId,
      date: cancelDateYmd,
    });

    return updated;
  }

  /**
   * Update appointment (drag/resize). Full availability validation (working hours, breaks, time off, holidays, overlap).
   */
  async updateAppointment(
    appointmentId: string,
    dto: { businessId: string; staffId?: string; startTime?: string; endTime?: string },
  ) {
    const t0 = wallClockMs();
    const operation = 'PATCH /appointments/:id';
    resetPrismaQueryDurationMs();
    let requestParsingMs = 0;
    let preCheckValidationMs = 0;
    let loadAppointmentMs = 0;
    let loadTargetSlotMs = 0;
    let validationMs = 0;
    let overlapCheckMs = 0;
    let transactionBodyMs = 0;
    let loadCurrentAppointmentForValidationMs = 0;
    let loadTargetSlotValidationMs = 0;
    let staffValidationMs = 0;
    let loadStaffBundleMs = 0;
    let staffConstraintValidationMs = 0;
    let serviceRulesValidationMs = 0;
    let availabilityValidationMs = 0;
    let workingHoursValidationMs = 0;
    let breaksValidationMs = 0;
    let timeOffValidationMs = 0;
    let holidayValidationMs = 0;
    let overlapValidationQueryMs = 0;
    let lockCurrentAppointmentMs = 0;
    let lockTargetSlotMs = 0;
    let loadCurrentAppointmentTxMs = 0;
    let txOverlapCheckMs = 0;
    let applyRescheduleUpdateMs = 0;
    let txCallbackMs = 0;
    let commitMs = 0;
    let postRescheduleInvalidationMs = 0;
    let timeSlotsRescheduleMs = 0;
    let timeSlotsMutationInsideTxMs = 0;
    let cacheUpdateMs = 0;
    let responseBuildMs = 0;
    let totalRescheduleMs = 0;
    let statusCode = 500;
    let resultType: 'success' | 'conflict' | 'error' = 'error';
    let conflictCode: string | undefined;
    let errorCode: string | undefined;
    let resultStaffId: string | undefined;
    let resultServiceId: string | undefined;
    let resultDate: string | undefined;
    let resultSlotTime: string | undefined;
    const rescheduleResponseInclude = {
      staff: { select: { id: true, firstName: true, lastName: true } },
      service: { select: { id: true, name: true, durationMinutes: true } },
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      branch: { select: { id: true, name: true } },
    } satisfies Prisma.AppointmentInclude;
      let updated:
      | Prisma.AppointmentGetPayload<{
          include: typeof rescheduleResponseInclude;
        }>
      | undefined;
      let updatedAppointmentId: string | undefined;
      let debugOldStartTime: Date | undefined;
      let debugOldEndTime: Date | undefined;
      let debugNewStartTime: Date | undefined;
      let debugNewEndTime: Date | undefined;
      let debugStaffId: string | undefined;
      try {
      const tLoad0 = wallClockMs();
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          id: true,
          businessId: true,
          staffId: true,
          serviceId: true,
          startTime: true,
          endTime: true,
          status: true,
          service: {
            select: {
              durationMinutes: true,
              bufferBeforeMinutes: true,
              bufferAfterMinutes: true,
            },
          },
        },
      });
      loadAppointmentMs = wallClockMs() - tLoad0;
      loadCurrentAppointmentForValidationMs = loadAppointmentMs;

      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }
      if (appointment.businessId !== dto.businessId) {
        throw new ForbiddenException('Appointment does not belong to this business');
      }
      if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(appointment.status)) {
        throw new BadRequestException(
          `Cannot update appointment with status ${appointment.status}`,
        );
      }

      const staffId = dto.staffId ?? appointment.staffId;
      const startTime = dto.startTime ? parseIsoToUtcJsDate(dto.startTime) : appointment.startTime;
      const endTime = dto.endTime ? parseIsoToUtcJsDate(dto.endTime) : appointment.endTime;
      debugOldStartTime = appointment.startTime;
      debugOldEndTime = appointment.endTime;
      debugNewStartTime = startTime;
      debugNewEndTime = endTime;
      debugStaffId = staffId;
      resultStaffId = staffId;
      resultServiceId = appointment.serviceId;
      this.logRescheduleDebug({
        phase: 'before_transaction',
        appointmentId,
        oldStartTime: appointment.startTime.toISOString(),
        oldEndTime: appointment.endTime.toISOString(),
        newStartTime: startTime.toISOString(),
        newEndTime: endTime.toISOString(),
      });

      const durationMinutes = Math.round(
        (endTime.getTime() - startTime.getTime()) / (60 * 1000),
      );

      const { timezone: updateWallTz } = await this.getBusinessTimezone(dto.businessId);

      const tServiceRules0 = wallClockMs();
      const svc = appointment.service;
      const svcDur = svc.durationMinutes > 0 ? svc.durationMinutes : 1;
      const requiredBlockMinutes =
        Math.max(1, svcDur) +
        (svc.bufferBeforeMinutes ?? 0) +
        (svc.bufferAfterMinutes ?? 0);
      serviceRulesValidationMs = wallClockMs() - tServiceRules0;

      if (durationMinutes < requiredBlockMinutes) {
        throw new BadRequestException(
          `Duration must be at least ${requiredBlockMinutes} minutes for this staff and service (includes buffers)`,
        );
      }

      const dateStr = formatBusinessTime(startTime, updateWallTz, 'yyyy-MM-dd');
      const startTimeStr = formatBusinessTime(startTime, updateWallTz, 'HH:mm');
      resultDate = dateStr;
      resultSlotTime = startTimeStr;
      const slotKey = `${dto.businessId}:${staffId}:${dateStr}:${startTimeStr}`;
      requestParsingMs = wallClockMs() - t0;
      this.emitPerfPhase({
        event: 'RESCHEDULE_PHASE',
        operation,
        requestType: 'reschedule',
        phase: 'request_parsing_input_normalization',
        phaseMs: requestParsingMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId,
        appointmentId,
        serviceId: appointment.serviceId,
        date: dateStr,
        slotTime: startTimeStr,
      });

      const validateT0 = wallClockMs();
      const validationInstrumentation = {
        staffValidationMs: 0,
        availabilityValidationMs: 0,
        loadStaffBundleMs: 0,
        staffConstraintValidationMs: 0,
        workingHoursValidationMs: 0,
        breaksValidationMs: 0,
        timeOffValidationMs: 0,
        holidayValidationMs: 0,
      };
      const validationResult = await this.validation.validateBookingSlot({
        businessId: dto.businessId,
        staffId,
        serviceId: appointment.serviceId,
        startTime,
        endTime,
        calendarDate: dateStr,
        startTimeHHmm: startTimeStr,
        resolvedTimeZone: updateWallTz,
        instrumentation: validationInstrumentation,
      });
      validationMs = wallClockMs() - validateT0;
      staffValidationMs = validationInstrumentation.staffValidationMs;
      loadStaffBundleMs = validationInstrumentation.loadStaffBundleMs;
      staffConstraintValidationMs =
        validationInstrumentation.staffConstraintValidationMs;
      availabilityValidationMs =
        validationInstrumentation.availabilityValidationMs;
      workingHoursValidationMs =
        validationInstrumentation.workingHoursValidationMs;
      breaksValidationMs = validationInstrumentation.breaksValidationMs;
      timeOffValidationMs = validationInstrumentation.timeOffValidationMs;
      holidayValidationMs = validationInstrumentation.holidayValidationMs;
      preCheckValidationMs = validationMs;
      throwIfInvalid(validationResult, this.logger);

      const previousDateStr = formatBusinessTime(
        appointment.startTime,
        updateWallTz,
        'yyyy-MM-dd',
      );
      const previousStartTimeStr = formatBusinessTime(
        appointment.startTime,
        updateWallTz,
        'HH:mm',
      );
      const previousEndTimeStr = formatBusinessTime(
        appointment.endTime,
        updateWallTz,
        'HH:mm',
      );
      const newEndTimeStr = formatBusinessTime(endTime, updateWallTz, 'HH:mm');
      const oldSlotRowsBefore = await this.loadTimeSlotRowsForWallRange({
        staffId: appointment.staffId,
        dateYmd: previousDateStr,
        startHhmm: previousStartTimeStr,
        endHhmm: previousEndTimeStr,
      });
      this.logRescheduleSlotSync({
        type: 'RESCHEDULE_SLOT_SYNC_BEFORE',
        appointmentId,
        staffId,
        oldDate: previousDateStr,
        oldStart: previousStartTimeStr,
        oldEnd: previousEndTimeStr,
        newDate: dateStr,
        newStart: startTimeStr,
        newEnd: newEndTimeStr,
        oldSlotRows: oldSlotRowsBefore,
      });
      const outboxPayload: RescheduleAppliedOutboxPayload = {
        previous: {
          staffId: appointment.staffId,
          dateYmd: previousDateStr,
          startMin: hhmmToMinutes(previousStartTimeStr),
          endMin: hhmmToMinutes(previousEndTimeStr),
        },
      };

      const txT0 = wallClockMs();
      const txUpdated = await this.prisma.$transaction(async (tx) => {
        const txCurrentRowBeforeUpdate = await tx.appointment.findUnique({
          where: { id: appointmentId },
          select: {
            id: true,
            startTime: true,
            endTime: true,
            status: true,
            staffId: true,
          },
        });
        this.logRescheduleDebug({
          phase: 'inside_transaction_after_locking_row',
          appointmentId,
          currentAppointmentRow: txCurrentRowBeforeUpdate
            ? {
                id: txCurrentRowBeforeUpdate.id,
                staffId: txCurrentRowBeforeUpdate.staffId,
                startTime: txCurrentRowBeforeUpdate.startTime.toISOString(),
                endTime: txCurrentRowBeforeUpdate.endTime.toISOString(),
                status: txCurrentRowBeforeUpdate.status,
              }
            : null,
        });
        const applyUpdateT0 = wallClockMs();
        const txAppointment = await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            staffId,
            startTime,
            endTime,
            slotKey,
          },
          select: { id: true },
        });
        applyRescheduleUpdateMs = wallClockMs() - applyUpdateT0;
        overlapCheckMs = applyRescheduleUpdateMs;
        const txUpdatedRow = await tx.appointment.findUnique({
          where: { id: appointmentId },
          select: {
            id: true,
            staffId: true,
            startTime: true,
            endTime: true,
            status: true,
            slotKey: true,
          },
        });
        this.logRescheduleDebug({
          phase: 'inside_transaction_after_update',
          appointmentId,
          updatedAppointmentRow: txUpdatedRow
            ? {
                id: txUpdatedRow.id,
                staffId: txUpdatedRow.staffId,
                startTime: txUpdatedRow.startTime.toISOString(),
                endTime: txUpdatedRow.endTime.toISOString(),
                status: txUpdatedRow.status,
                slotKey: txUpdatedRow.slotKey,
              }
            : null,
          oldSlotRangeNoLongerUsed:
            !!txUpdatedRow &&
            !(
              txUpdatedRow.startTime.getTime() === appointment.startTime.getTime() &&
              txUpdatedRow.endTime.getTime() === appointment.endTime.getTime()
            ),
        });

        if (this.useTimeSlots) {
          const tTimeSlotsTx0 = wallClockMs();
          const telemetry = await this.timeSlots.rescheduleBookingInTransaction(tx, {
            appointmentId,
            staffId,
            dateYmd: dateStr,
            startTime: startTimeStr,
            durationMinutes,
            timeZone: updateWallTz,
          });
          timeSlotsMutationInsideTxMs += wallClockMs() - tTimeSlotsTx0;
          timeSlotsRescheduleMs += telemetry.timeSlotsUpdateMs;
        }

        await tx.$executeRaw`
          INSERT INTO "booking_projection_outbox" (
            "event_type",
            "status",
            "business_id",
            "appointment_id",
            "payload",
            "attempts",
            "available_at",
            "created_at",
            "updated_at"
          )
          VALUES (
            ${BOOKING_PROJECTION_RESCHEDULE_EVENT_TYPE},
            'PENDING',
            ${dto.businessId},
            ${appointmentId},
            CAST(${JSON.stringify(outboxPayload)} AS jsonb),
            0,
            now(),
            now(),
            now()
          )
        `;

        return txAppointment;
      });
      updatedAppointmentId = txUpdated.id;
      transactionBodyMs = wallClockMs() - txT0;
      txCallbackMs = transactionBodyMs;
      commitMs = 0;
      if (
        debugOldStartTime &&
        debugOldEndTime &&
        debugStaffId
      ) {
        const overlappingAppointments = await this.prisma.appointment.findMany({
          where: {
            businessId: dto.businessId,
            staffId: debugStaffId,
            startTime: { lt: debugOldEndTime },
            endTime: { gt: debugOldStartTime },
            status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
          },
          select: { id: true, startTime: true, endTime: true, status: true },
          orderBy: { startTime: 'asc' },
        });
        const activeSlotHolds = await this.prisma.slotHold.findMany({
          where: {
            businessId: dto.businessId,
            staffId: debugStaffId,
            expiresAt: { gt: new Date() },
            consumedAt: null,
          },
          select: { id: true, startTime: true, endTime: true, expiresAt: true },
          orderBy: { startTime: 'asc' },
        });
        this.logRescheduleDebug({
          phase: 'post_transaction_db_state',
          appointmentId,
          oldStartTime: debugOldStartTime.toISOString(),
          oldEndTime: debugOldEndTime.toISOString(),
          newStartTime: debugNewStartTime?.toISOString(),
          newEndTime: debugNewEndTime?.toISOString(),
          overlappingAppointmentsOnOldRange: overlappingAppointments.map((row) => ({
            id: row.id,
            startTime: row.startTime.toISOString(),
            endTime: row.endTime.toISOString(),
            status: row.status,
          })),
          activeSlotHolds: activeSlotHolds.map((row) => ({
            id: row.id,
            startTime: row.startTime.toISOString(),
            endTime: row.endTime.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
          })),
        });
      }
      void this.markDirtyWindows({
        businessId: dto.businessId,
        windows: [
          {
            staffId: appointment.staffId,
            dateYmd: previousDateStr,
            startMin: hhmmToMinutes(previousStartTimeStr),
            endMin: hhmmToMinutes(previousEndTimeStr),
          },
          {
            staffId,
            dateYmd: dateStr,
            startMin: hhmmToMinutes(startTimeStr),
            endMin: hhmmToMinutes(newEndTimeStr),
          },
        ],
      }).catch((e) =>
        this.logger.warn(
          `[RescheduleDirtyWindow] mark failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );
      const tInvalidation0 = wallClockMs();
      const tOverlay0 = wallClockMs();
      await this.availabilityOverlay.removeBooked({
        businessId: dto.businessId,
        staffId: appointment.staffId,
        dateYmd: previousDateStr,
        appointmentId,
      });
      await this.availabilityOverlay.upsertBooked({
        businessId: dto.businessId,
        staffId,
        dateYmd: dateStr,
        appointmentId,
        startMin: hhmmToMinutes(startTimeStr),
        endMin: hhmmToMinutes(newEndTimeStr),
      });
      const overlayMs = wallClockMs() - tOverlay0;

      const affectedDates = new Map<string, { staffId: string; dateYmd: string }>();
      affectedDates.set(`${appointment.staffId}:${previousDateStr}`, {
        staffId: appointment.staffId,
        dateYmd: previousDateStr,
      });
      affectedDates.set(`${staffId}:${dateStr}`, {
        staffId,
        dateYmd: dateStr,
      });
      for (const target of affectedDates.values()) {
        await this.bustAvailabilityCache(dto.businessId, target.staffId, target.dateYmd);
        await this.hotAvailabilityCache.refreshCachedServicesForDay(
          dto.businessId,
          target.staffId,
          target.dateYmd,
        );
      }
      postRescheduleInvalidationMs = wallClockMs() - tInvalidation0;
      cacheUpdateMs = postRescheduleInvalidationMs;
      this.emitPerfPhase({
        event: 'RESCHEDULE_PHASE',
        operation,
        requestType: 'reschedule',
        phase: 'reschedule_overlay_update',
        phaseMs: overlayMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId,
        appointmentId,
        serviceId: appointment.serviceId,
        date: dateStr,
        slotTime: startTimeStr,
      });
      this.emitPerfPhase({
        event: 'RESCHEDULE_PHASE',
        operation,
        requestType: 'reschedule',
        phase: 'post_reschedule_invalidation',
        phaseMs: postRescheduleInvalidationMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId,
        appointmentId,
        serviceId: appointment.serviceId,
        date: dateStr,
        slotTime: startTimeStr,
      });
      const oldSlotRowsAfter = await this.loadTimeSlotRowsForWallRange({
        staffId: appointment.staffId,
        dateYmd: previousDateStr,
        startHhmm: previousStartTimeStr,
        endHhmm: previousEndTimeStr,
      });
      const newSlotRowsAfter = await this.loadTimeSlotRowsForWallRange({
        staffId,
        dateYmd: dateStr,
        startHhmm: startTimeStr,
        endHhmm: newEndTimeStr,
      });
      const oldDateCacheInvalidated = affectedDates.has(
        `${appointment.staffId}:${previousDateStr}`,
      );
      const newDateCacheInvalidated = affectedDates.has(`${staffId}:${dateStr}`);
      this.logRescheduleSlotSync({
        type: 'RESCHEDULE_SLOT_SYNC_AFTER',
        appointmentId,
        oldSlotRowsAfter,
        newSlotRowsAfter,
        oldDateCacheInvalidated,
        newDateCacheInvalidated,
      });
      this.emitPerfPhase({
        event: 'RESCHEDULE_PHASE',
        operation,
        requestType: 'reschedule',
        phase: 'pre_check_validation',
        phaseMs: preCheckValidationMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId,
        appointmentId,
        serviceId: appointment.serviceId,
        date: dateStr,
        slotTime: startTimeStr,
      });
      this.emitPerfPhase({
        event: 'RESCHEDULE_PHASE',
        operation,
        requestType: 'reschedule',
        phase: 'conflict_detection',
        phaseMs: overlapCheckMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId,
        appointmentId,
        serviceId: appointment.serviceId,
        date: dateStr,
        slotTime: startTimeStr,
      });
      this.emitPerfPhase({
        event: 'RESCHEDULE_PHASE',
        operation,
        requestType: 'reschedule',
        phase: 'transaction_body',
        phaseMs: transactionBodyMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId,
        appointmentId,
        serviceId: appointment.serviceId,
        date: dateStr,
        slotTime: startTimeStr,
      });
      this.emitPerfPhase({
        event: 'RESCHEDULE_PHASE',
        operation,
        requestType: 'reschedule',
        phase: 'time_slots_update',
        phaseMs: timeSlotsRescheduleMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId,
        appointmentId,
        serviceId: appointment.serviceId,
        date: dateStr,
        slotTime: startTimeStr,
      });
      statusCode = 200;
      resultType = 'success';
      updated = (await this.prisma.appointment.findUnique({
        where: { id: updatedAppointmentId ?? appointmentId },
        include: rescheduleResponseInclude,
      })) ?? undefined;
      if (!updated) {
        throw new NotFoundException('Appointment not found after reschedule');
      }
      responseBuildMs = this.measureSerializationMs(updated);
      this.emitPerfPhase({
        event: 'RESCHEDULE_PHASE',
        operation,
        requestType: 'reschedule',
        phase: 'response_serialization',
        phaseMs: responseBuildMs,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId,
        appointmentId,
        serviceId: appointment.serviceId,
        date: dateStr,
        slotTime: startTimeStr,
        statusCode,
        resultType,
      });

      return updated;
    } catch (e: unknown) {
      if (isPrismaExclusion23P01(e)) {
        statusCode = 409;
        resultType = 'conflict';
        conflictCode = BOOKING_SLOT_CONFLICT_CODE;
        throw new ConflictException(
          'Updated time overlaps another appointment for this staff member.',
        );
      }
      if (e instanceof ConflictException) {
        statusCode = 409;
        resultType = 'conflict';
      } else {
        const status =
          typeof (e as { getStatus?: () => number })?.getStatus === 'function'
            ? (e as { getStatus: () => number }).getStatus()
            : undefined;
        statusCode = typeof status === 'number' ? status : 500;
        resultType = statusCode === 409 ? 'conflict' : 'error';
      }
      const body =
        typeof (e as { getResponse?: () => unknown })?.getResponse === 'function'
          ? (e as { getResponse: () => unknown }).getResponse()
          : undefined;
      if (body && typeof body === 'object') {
        const rec = body as Record<string, unknown>;
        if (typeof rec.code === 'string') {
          if (resultType === 'conflict') conflictCode = rec.code;
          else errorCode = rec.code;
        }
      }
      throw e;
    } finally {
      if (this.shouldLogReschedulePerf()) {
        const prismaQueries = getPrismaMiddlewareQueryRecords();
        const prismaQueryEvents = getPrismaQueryEventRecords();
        const prismaDbMs = getPrismaQueryDurationMs() ?? 0;
        const combinedQueries = prismaQueries.map((q, index) => {
          const event = prismaQueryEvents[index];
          return {
            model: q.model,
            action: q.action,
            durationMs: q.durationMs,
            sqlDurationMs: event?.durationMs,
            target: event?.target,
            sql: event?.sql,
            params: event?.params,
          };
        });
        const rawSqlQueries = combinedQueries.filter((q) => q.model === 'raw');
        const timedSteps = [
          {
            name: 'loadCurrentAppointmentForValidationMs',
            value: loadCurrentAppointmentForValidationMs,
          },
          { name: 'loadTargetSlotMs', value: loadTargetSlotMs },
          { name: 'validationMs', value: validationMs },
          { name: 'overlapCheckMs', value: overlapCheckMs },
          { name: 'transactionMs', value: transactionBodyMs },
          { name: 'timeSlotsRescheduleMs', value: timeSlotsRescheduleMs },
          { name: 'cacheUpdateMs', value: cacheUpdateMs },
        ];
        const transactionTimedSteps = [
          { name: 'txCallbackMs', value: txCallbackMs },
          { name: 'lockCurrentAppointmentMs', value: lockCurrentAppointmentMs },
          { name: 'lockTargetSlotMs', value: lockTargetSlotMs },
          { name: 'loadCurrentAppointmentTxMs', value: loadCurrentAppointmentTxMs },
          { name: 'txOverlapCheckMs', value: txOverlapCheckMs },
          { name: 'applyRescheduleUpdateMs', value: applyRescheduleUpdateMs },
          {
            name: 'timeSlotsMutationInsideTxMs',
            value: timeSlotsMutationInsideTxMs,
          },
          { name: 'commitMs', value: commitMs },
        ];
        const dominantStep = timedSteps.reduce((max, step) =>
          step.value > max.value ? step : max,
        );
        const transactionDominantStep = transactionTimedSteps.reduce((max, step) =>
          step.value > max.value ? step : max,
        );
        totalRescheduleMs = wallClockMs() - t0;
        const pathClass =
          statusCode === 409
            ? 'reschedule_conflict_409'
            : statusCode >= 200 && statusCode < 300
              ? 'reschedule_success'
              : 'reschedule_error';
        try {
          console.log(
            JSON.stringify({
              type: 'RESCHEDULE_PERF',
              operation,
              appointmentId,
              businessId: dto.businessId,
              staffId: resultStaffId,
              serviceId: resultServiceId,
              date: resultDate,
              slotTime: resultSlotTime,
              statusCode,
              resultType,
              conflictCode,
              errorCode,
              loadAppointmentMs: Math.round(loadAppointmentMs),
              loadCurrentAppointmentForValidationMs: Math.round(
                loadCurrentAppointmentForValidationMs,
              ),
              loadTargetSlotMs: Math.round(loadTargetSlotMs),
              loadTargetSlotValidationMs: Math.round(loadTargetSlotValidationMs),
              validationMs: Math.round(validationMs),
              staffValidationMs: Math.round(staffValidationMs),
              loadStaffBundleMs: Math.round(loadStaffBundleMs),
              staffConstraintValidationMs: Math.round(
                staffConstraintValidationMs,
              ),
              serviceRulesValidationMs: Math.round(serviceRulesValidationMs),
              availabilityValidationMs: Math.round(availabilityValidationMs),
              workingHoursValidationMs: Math.round(workingHoursValidationMs),
              breaksValidationMs: Math.round(breaksValidationMs),
              timeOffValidationMs: Math.round(timeOffValidationMs),
              holidayValidationMs: Math.round(holidayValidationMs),
              overlapValidationQueryMs: Math.round(overlapValidationQueryMs),
              overlapCheckMs: Math.round(overlapCheckMs),
              transactionMs: Math.round(transactionBodyMs),
              timeSlotsRescheduleMs: Math.round(timeSlotsRescheduleMs),
              cacheUpdateMs: Math.round(cacheUpdateMs),
              totalMs: Math.round(totalRescheduleMs),
              totalRescheduleMs: Math.round(totalRescheduleMs),
              dominantStep: dominantStep.name,
              dominantStepMs: Math.round(dominantStep.value),
              txCallbackMs: Math.round(txCallbackMs),
              lockCurrentAppointmentMs: Math.round(lockCurrentAppointmentMs),
              lockTargetSlotMs: Math.round(lockTargetSlotMs),
              loadCurrentAppointmentTxMs: Math.round(loadCurrentAppointmentTxMs),
              txOverlapCheckMs: Math.round(txOverlapCheckMs),
              applyRescheduleUpdateMs: Math.round(applyRescheduleUpdateMs),
              timeSlotsMutationInsideTxMs: Math.round(timeSlotsMutationInsideTxMs),
              commitMs: Math.round(commitMs),
              transactionDominantStep: transactionDominantStep.name,
              transactionDominantStepMs: Math.round(transactionDominantStep.value),
              prismaDbMs: Math.round(prismaDbMs),
              prismaQueryCount: prismaQueries.length,
              rawSqlCount: rawSqlQueries.length,
            }),
          );
          console.log(
            JSON.stringify({
              type: 'RESCHEDULE_PHASE_BREAKDOWN',
              pathClass,
              operation,
              appointmentId,
              businessId: dto.businessId,
              staffId: resultStaffId,
              serviceId: resultServiceId,
              date: resultDate,
              slotTime: resultSlotTime,
              statusCode,
              resultType,
              conflictCode,
              errorCode,
              loadAppointmentMs: Math.round(loadAppointmentMs),
              loadCurrentAppointmentForValidationMs: Math.round(
                loadCurrentAppointmentForValidationMs,
              ),
              loadTargetSlotMs: Math.round(loadTargetSlotMs),
              loadTargetSlotValidationMs: Math.round(loadTargetSlotValidationMs),
              validationMs: Math.round(validationMs),
              staffValidationMs: Math.round(staffValidationMs),
              loadStaffBundleMs: Math.round(loadStaffBundleMs),
              staffConstraintValidationMs: Math.round(
                staffConstraintValidationMs,
              ),
              serviceRulesValidationMs: Math.round(serviceRulesValidationMs),
              availabilityValidationMs: Math.round(availabilityValidationMs),
              workingHoursValidationMs: Math.round(workingHoursValidationMs),
              breaksValidationMs: Math.round(breaksValidationMs),
              timeOffValidationMs: Math.round(timeOffValidationMs),
              holidayValidationMs: Math.round(holidayValidationMs),
              overlapValidationQueryMs: Math.round(overlapValidationQueryMs),
              overlapCheckMs: Math.round(overlapCheckMs),
              transactionMs: Math.round(transactionBodyMs),
              timeSlotsRescheduleMs: Math.round(timeSlotsRescheduleMs),
              cacheUpdateMs: Math.round(cacheUpdateMs),
              responseBuildMs: Math.round(responseBuildMs),
              totalMs: Math.round(totalRescheduleMs),
              totalRescheduleMs: Math.round(totalRescheduleMs),
              dominantStep: dominantStep.name,
              dominantStepMs: Math.round(dominantStep.value),
              txCallbackMs: Math.round(txCallbackMs),
              lockCurrentAppointmentMs: Math.round(lockCurrentAppointmentMs),
              lockTargetSlotMs: Math.round(lockTargetSlotMs),
              loadCurrentAppointmentTxMs: Math.round(loadCurrentAppointmentTxMs),
              txOverlapCheckMs: Math.round(txOverlapCheckMs),
              applyRescheduleUpdateMs: Math.round(applyRescheduleUpdateMs),
              timeSlotsMutationInsideTxMs: Math.round(timeSlotsMutationInsideTxMs),
              commitMs: Math.round(commitMs),
              transactionDominantStep: transactionDominantStep.name,
              transactionDominantStepMs: Math.round(transactionDominantStep.value),
              prismaDbMs: Math.round(prismaDbMs),
              prismaQueryCount: prismaQueries.length,
              rawSqlCount: rawSqlQueries.length,
            }),
          );
          for (const q of combinedQueries) {
            console.log(
              JSON.stringify({
                type: 'RESCHEDULE_PRISMA_QUERY',
                operation,
                appointmentId,
                businessId: dto.businessId,
                model: q.model,
                action: q.action,
                durationMs: q.durationMs,
                sqlDurationMs: q.sqlDurationMs,
                target: q.target,
                sql: q.sql,
              }),
            );
          }
          for (const q of rawSqlQueries) {
            console.log(
              JSON.stringify({
                type: 'RESCHEDULE_RAW_SQL',
                operation,
                appointmentId,
                businessId: dto.businessId,
                action: q.action,
                durationMs: q.durationMs,
                sqlDurationMs: q.sqlDurationMs,
                target: q.target,
                sql: q.sql,
              }),
            );
          }
        } catch {
          /* ignore */
        }
      }
      this.emitPerfPhase({
        event: 'RESCHEDULE_PHASE',
        operation,
        requestType: 'reschedule',
        phase: 'total',
        phaseMs: wallClockMs() - t0,
        totalMs: wallClockMs() - t0,
        businessId: dto.businessId,
        staffId: resultStaffId,
        appointmentId,
        serviceId: resultServiceId,
        date: resultDate,
        slotTime: resultSlotTime,
        statusCode,
        resultType,
        conflictCode,
        errorCode,
      });
      this.emitWritePathStageProfile({
        flow: 'reschedule',
        operation,
        businessId: dto.businessId,
        statusCode,
        resultType,
        validationMs,
        dbMs: transactionBodyMs,
        transactionMs: transactionBodyMs,
        totalMs: wallClockMs() - t0,
        appointmentId,
        staffId: resultStaffId,
        serviceId: resultServiceId,
        conflictCode,
        errorCode,
      });
    }
  }

  async updateAppointmentStatus(
    appointmentId: string,
    businessId: string,
    status: 'COMPLETED' | 'NO_SHOW',
    actorUserId?: string,
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        service: { select: { price: true } },
        payment: { select: { amount: true, status: true } },
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }
    if (appointment.businessId !== businessId) {
      throw new ForbiddenException('Appointment does not belong to this business');
    }
    if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(appointment.status)) {
      throw new BadRequestException(
        `Cannot update appointment with status ${appointment.status}`,
      );
    }

    let price = 0;
    if (status === 'COMPLETED') {
      if (appointment.payment?.status === 'SUCCEEDED') {
        price = Number(appointment.payment.amount);
      } else {
        const staffService = await this.prisma.staffService.findUnique({
          where: {
            staffId_serviceId: {
              staffId: appointment.staffId,
              serviceId: appointment.serviceId,
            },
          },
        });
        price = staffService
          ? Number(staffService.price)
          : Number(appointment.service.price);
      }
    }

    const completedByStaffId = actorUserId
      ? (
          await this.prisma.staff.findFirst({
            where: { businessId, userId: actorUserId, deletedAt: null },
            select: { id: true },
          })
        )?.id ?? null
      : null;

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status },
      include: {
        staff: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
    });
    try {
      if (status === 'COMPLETED') {
        await this.prisma.$executeRaw`
          UPDATE appointments
          SET "completedAt" = NOW(),
              "noShowAt" = NULL,
              "completedByStaffId" = ${completedByStaffId}
          WHERE id = ${appointmentId}
        `;
      } else {
        await this.prisma.$executeRaw`
          UPDATE appointments
          SET "noShowAt" = NOW(),
              "completedAt" = NULL
          WHERE id = ${appointmentId}
        `;
      }
    } catch {
      // Backward-compatible deployment: ignore until migration is applied.
    }

    this.customerVisits
      .createFromAppointment(appointmentId, status, price)
      .catch((e) => console.error('[Booking] createFromAppointment failed:', e));

    const bizTzRow = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    const tz = ensureValidBusinessZone(resolveScheduleWallClockZone(bizTzRow?.timezone));
    const dateYmd = formatBusinessTime(appointment.startTime, tz, 'yyyy-MM-dd');
    await this.bustAvailabilityCache(businessId, appointment.staffId, dateYmd);

    return updated;
  }

  /**
   * Invalidate availability + busy layers for one business-local day after writes (book/cancel/
   * reschedule/hold/status). Keys scoped by staffId + date (`ymd`) plus business for `av:busy` / `av:day`.
   *
   * Redis (representative):
   * - `av:busy:{businessId}:{staffId}:{ymd}`
   * - `av:day:{businessId}:{staffId}:*:{ymd}`
   * - `av:v2:{staffId}:*:{ymd}`
   * - Legacy: `availability:{staffId}:{ymd}`, `appointments:day:{staffId}:{ymd}`
   */
  /** Single key per staff-day: `availability:{businessId}:{staffId}:{ymd}`. */
  private async bustTimeSlotsReadCache(
    businessId: string,
    staffId: string,
    dateYmd: string,
  ): Promise<void> {
    if (!this.availabilityTimeSlotsRedisCacheOn) return;
    const ymd = dateYmd.slice(0, 10);
    await this.cache.del(
      CacheService.keys.availabilityHotDay(businessId, staffId, ymd),
    );
  }

  private async bustAvailabilityCache(
    businessId: string,
    staffId: string,
    dateYmd: string,
  ): Promise<void> {
    const ymd = dateYmd.slice(0, 10);
    const SKIP_PATTERN_BUST = true;
    // With USE_TIME_SLOTS=1 the live read path is one exact staff-day key.
    // Skipping broad SCAN-based invalidation keeps hold/book latency down
    // while DB constraints remain the source of truth for correctness.
    if (this.useTimeSlots && SKIP_PATTERN_BUST) {
      const tBust0 = wallClockMs();
      await Promise.all([
        this.bustTimeSlotsReadCache(businessId, staffId, ymd),
        this.cache.del(CacheService.keys.availability(staffId, ymd)),
        this.cache.del(CacheService.keys.appointmentsDay(staffId, ymd)),
      ]);
      this.emitPerfPhase({
        event: 'BOOK_PHASE',
        requestType: 'book',
        phase: 'availability_cache_bust_fast_path',
        phaseMs: wallClockMs() - tBust0,
        totalMs: wallClockMs() - tBust0,
        businessId,
        staffId,
        date: ymd,
      });
      return;
    }

    const tBust0 = wallClockMs();
    await Promise.all([
      this.bustTimeSlotsReadCache(businessId, staffId, ymd),
      this.cache.delPattern(
        CacheService.keys.availabilityComputedPatternForStaffDate(staffId, ymd),
        'bust_av_computed_staff_date',
      ),
      this.cache.del(CacheService.keys.availabilityBusyIntervals(businessId, staffId, ymd)),
      this.cache.delPattern(
        CacheService.keys.availabilityBusyIntervalsPatternForStaffDate(staffId, ymd),
        'bust_av_busy_pattern',
      ),
      this.cache.delPattern(
        CacheService.keys.availabilityDayFullPatternForStaffDate(businessId, staffId, ymd),
        'bust_av_day_full_pattern',
      ),
      this.cache.del(CacheService.keys.availability(staffId, ymd)),
      this.cache.del(CacheService.keys.appointmentsDay(staffId, ymd)),
    ]);
    this.emitPerfPhase({
      event: 'BOOK_PHASE',
      requestType: 'book',
      phase: 'availability_cache_bust_full_path',
      phaseMs: wallClockMs() - tBust0,
      totalMs: wallClockMs() - tBust0,
      businessId,
      staffId,
      date: ymd,
    });
  }

}
