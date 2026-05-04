import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TimeSlotService } from '../availability/time-slot.service';
import { AvailabilityOverlayService } from '../availability/availability-overlay.service';
import { CacheService } from '../redis/cache.service';
import { isSchedulerPrimaryInstance } from '../common/scheduler-instance';
import { enableRedis } from '../common/redis-config';
import {
  ensureValidBusinessZone,
  formatBusinessTime,
} from '../common/time-engine';
import { resolveScheduleWallClockZone } from '../common/business-local-time';
import { hhmmToMinutes } from '../availability/simple-availability.engine';
import {
  BOOKING_PROJECTION_RESCHEDULE_EVENT_TYPE,
  parseRescheduleAppliedOutboxPayload,
} from './booking-projection-outbox.types';

type ClaimedOutboxEventRow = {
  id: string;
  businessId: string;
  appointmentId: string;
  payload: unknown;
  attempts: number;
};

type CurrentSlot = {
  dateYmd: string;
  startTime: string;
};

/**
 * Booking Core Stable v1
 * Frozen after correctness/performance validation.
 * Modify cautiously.
 */
@Injectable()
export class BookingRescheduleProjectionWorkerService {
  private readonly logger = new Logger(BookingRescheduleProjectionWorkerService.name);
  private running = false;
  private readonly timeZoneCache = new Map<
    string,
    { timezone: string; expiresAtMs: number }
  >();
  private readonly workerId = `reschedule-projection:${process.pid}`;
  private static readonly TIME_ZONE_CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly MAX_BATCH_SIZE = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly timeSlots: TimeSlotService,
    private readonly availabilityOverlay: AvailabilityOverlayService,
    private readonly cache: CacheService,
  ) {}

  private get useTimeSlots(): boolean {
    const projectionRaw = (this.config.get<string>('TIME_SLOT_PROJECTION_ENABLED') ?? '')
      .trim()
      .toLowerCase();
    const projectionEnabled = projectionRaw === 'true' || projectionRaw === '1';
    return projectionEnabled && this.config.get<string>('USE_TIME_SLOTS') === '1';
  }

  private get availabilityTimeSlotsRedisCacheOn(): boolean {
    return (
      enableRedis && this.config.get<string>('AVAILABILITY_REDIS_CACHE') === '1'
    );
  }

  private get batchSize(): number {
    const raw = this.config.get<string>('RESCHEDULE_OUTBOX_BATCH_SIZE');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, BookingRescheduleProjectionWorkerService.MAX_BATCH_SIZE);
    }
    return 20;
  }

  @Cron('*/2 * * * * *')
  async processRescheduleProjectionEvents(): Promise<void> {
    if (!isSchedulerPrimaryInstance()) return;
    if (this.running) return;

    this.running = true;
    try {
      const claimed = await this.claimPendingRescheduleEvents(this.batchSize);
      if (claimed.length === 0) return;

      for (const event of claimed) {
        await this.processOne(event);
      }
    } catch (error) {
      this.logger.warn(
        `processRescheduleProjectionEvents failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.running = false;
    }
  }

  private async claimPendingRescheduleEvents(limit: number): Promise<ClaimedOutboxEventRow[]> {
    return this.prisma.$queryRaw<ClaimedOutboxEventRow[]>`
      WITH to_claim AS (
        SELECT o."id"
        FROM "booking_projection_outbox" AS o
        WHERE o."status" = 'PENDING'
          AND o."event_type" = ${BOOKING_PROJECTION_RESCHEDULE_EVENT_TYPE}
          AND o."available_at" <= now()
        ORDER BY o."created_at" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "booking_projection_outbox" AS o
      SET
        "status" = 'PROCESSING',
        "locked_at" = now(),
        "locked_by" = ${this.workerId},
        "updated_at" = now()
      FROM to_claim
      WHERE o."id" = to_claim."id"
      RETURNING
        o."id",
        o."business_id" AS "businessId",
        o."appointment_id" AS "appointmentId",
        o."payload",
        o."attempts"
    `;
  }

  private async processOne(event: ClaimedOutboxEventRow): Promise<void> {
    try {
      const payload = parseRescheduleAppliedOutboxPayload(event.payload);
      if (!payload) {
        await this.markDone(event.id, 'invalid outbox payload');
        return;
      }

      const appointment = await this.prisma.appointment.findUnique({
        where: { id: event.appointmentId },
        select: {
          id: true,
          businessId: true,
          staffId: true,
          startTime: true,
          endTime: true,
          slotKey: true,
          status: true,
        },
      });

      if (!appointment || appointment.businessId !== event.businessId) {
        await this.markDone(event.id, 'appointment missing or business mismatch');
        return;
      }

      const timeZone = await this.getBusinessTimeZone(appointment.businessId);
      const slot = this.extractCurrentSlot(appointment, timeZone);
      if (!slot) {
        throw new Error('Could not resolve current slot from appointment');
      }

      const durationMinutes = Math.max(
        1,
        Math.round((appointment.endTime.getTime() - appointment.startTime.getTime()) / 60000),
      );
      const currentStartMin = hhmmToMinutes(slot.startTime);
      const currentEndMin = currentStartMin + durationMinutes;

      if (this.useTimeSlots) {
        await this.timeSlots.rescheduleBooking({
          appointmentId: appointment.id,
          staffId: appointment.staffId,
          dateYmd: slot.dateYmd,
          startTime: slot.startTime,
          durationMinutes,
          timeZone,
        });
      }

      await this.availabilityOverlay.removeBooked({
        businessId: appointment.businessId,
        staffId: payload.previous.staffId,
        dateYmd: payload.previous.dateYmd,
        appointmentId: appointment.id,
      });

      const isActive =
        appointment.status !== 'CANCELLED' &&
        appointment.status !== 'NO_SHOW' &&
        appointment.status !== 'COMPLETED';
      if (isActive) {
        await this.availabilityOverlay.upsertBooked({
          businessId: appointment.businessId,
          staffId: appointment.staffId,
          dateYmd: slot.dateYmd,
          appointmentId: appointment.id,
          startMin: currentStartMin,
          endMin: currentEndMin,
        });
      }

      const affected = new Map<string, { staffId: string; dateYmd: string }>();
      affected.set(`${payload.previous.staffId}:${payload.previous.dateYmd}`, {
        staffId: payload.previous.staffId,
        dateYmd: payload.previous.dateYmd,
      });
      affected.set(`${appointment.staffId}:${slot.dateYmd}`, {
        staffId: appointment.staffId,
        dateYmd: slot.dateYmd,
      });

      for (const target of affected.values()) {
        await this.bustAvailabilityCache(appointment.businessId, target.staffId, target.dateYmd);
      }
      for (const target of affected.values()) {
        await this.cache.del(
          CacheService.keys.availabilityRescheduleDirtyWindows(
            appointment.businessId,
            target.staffId,
            target.dateYmd,
          ),
        );
      }

      await this.markDone(event.id);
    } catch (error) {
      await this.requeueWithBackoff(event, error);
    }
  }

  private extractCurrentSlot(
    appointment: {
      businessId: string;
      staffId: string;
      startTime: Date;
      slotKey: string;
    },
    timeZone: string,
  ): CurrentSlot | null {
    const parts = appointment.slotKey.split(':');
    if (parts.length === 4) {
      const dateYmd = parts[2];
      const startTime = parts[3];
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(dateYmd) &&
        /^\d{2}:\d{2}$/.test(startTime)
      ) {
        return { dateYmd, startTime };
      }
    }

    return {
      dateYmd: formatBusinessTime(appointment.startTime, timeZone, 'yyyy-MM-dd'),
      startTime: formatBusinessTime(appointment.startTime, timeZone, 'HH:mm'),
    };
  }

  private async getBusinessTimeZone(businessId: string): Promise<string> {
    const cached = this.timeZoneCache.get(businessId);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.timezone;
    }

    const row = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    const timezone = ensureValidBusinessZone(resolveScheduleWallClockZone(row?.timezone));
    this.timeZoneCache.set(businessId, {
      timezone,
      expiresAtMs: Date.now() + BookingRescheduleProjectionWorkerService.TIME_ZONE_CACHE_TTL_MS,
    });
    return timezone;
  }

  private async markDone(id: string, note?: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "booking_projection_outbox"
      SET
        "status" = 'DONE',
        "processed_at" = now(),
        "locked_at" = NULL,
        "locked_by" = NULL,
        "last_error" = ${note ?? null},
        "updated_at" = now()
      WHERE "id" = ${id}
    `;
  }

  private async requeueWithBackoff(
    event: ClaimedOutboxEventRow,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof Error ? error.message : String(error);
    const nextAttempts = event.attempts + 1;
    const backoffSec = Math.min(60, Math.max(2, 2 ** Math.min(nextAttempts, 6)));
    const availableAt = new Date(Date.now() + backoffSec * 1000);
    await this.prisma.$executeRaw`
      UPDATE "booking_projection_outbox"
      SET
        "status" = 'PENDING',
        "attempts" = ${nextAttempts},
        "available_at" = ${availableAt},
        "locked_at" = NULL,
        "locked_by" = NULL,
        "last_error" = ${message.slice(0, 1000)},
        "updated_at" = now()
      WHERE "id" = ${event.id}
    `;
    this.logger.warn(
      `[RescheduleProjection] requeued event=${event.id} attempts=${nextAttempts}: ${message}`,
    );
  }

  private async bustTimeSlotsReadCache(
    businessId: string,
    staffId: string,
    dateYmd: string,
  ): Promise<void> {
    if (!this.availabilityTimeSlotsRedisCacheOn) return;
    const ymd = dateYmd.slice(0, 10);
    await this.cache.del(CacheService.keys.availabilityHotDay(businessId, staffId, ymd));
  }

  private async bustAvailabilityCache(
    businessId: string,
    staffId: string,
    dateYmd: string,
  ): Promise<void> {
    const ymd = dateYmd.slice(0, 10);
    const skipPatternBust = true;
    if (this.useTimeSlots && skipPatternBust) {
      await Promise.all([
        this.bustTimeSlotsReadCache(businessId, staffId, ymd),
        this.cache.del(CacheService.keys.availability(staffId, ymd)),
        this.cache.del(CacheService.keys.appointmentsDay(staffId, ymd)),
      ]);
      return;
    }

    await Promise.all([
      this.bustTimeSlotsReadCache(businessId, staffId, ymd),
      this.cache.delPattern(
        CacheService.keys.availabilityComputedPatternForStaffDate(staffId, ymd),
        'outbox_reschedule_bust_av_computed',
      ),
      this.cache.del(CacheService.keys.availabilityBusyIntervals(businessId, staffId, ymd)),
      this.cache.delPattern(
        CacheService.keys.availabilityBusyIntervalsPatternForStaffDate(staffId, ymd),
        'outbox_reschedule_bust_av_busy',
      ),
      this.cache.delPattern(
        CacheService.keys.availabilityDayFullPatternForStaffDate(businessId, staffId, ymd),
        'outbox_reschedule_bust_av_day',
      ),
      this.cache.del(CacheService.keys.availability(staffId, ymd)),
      this.cache.del(CacheService.keys.appointmentsDay(staffId, ymd)),
    ]);
  }
}
