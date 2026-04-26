import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { getAvailabilitySlotStepMinutes } from '../common/availability-slot-interval';
import {
  businessLocalDayBounds,
  businessLocalDayOfWeek,
  resolveScheduleWallClockZone,
  resolveStaffWorkingHoursForBusinessLocalDay,
  wallHhmmStringToMinuteOfDay,
} from '../common/business-local-time';
import { ensureValidBusinessZone } from '../common/time-engine';
import {
  hhmmToMinutes,
  minutesToHhmm,
  subtractRanges,
  type TimeRangeMin,
} from './simple-availability.engine';
import {
  computeSlotStartsFromWorkingAndBusy,
} from './business-local-interval-availability.engine';

export type TimeSlotRow = {
  id: string;
  startTime: string;
  endMin: number;
  status: string;
};

export type RescheduleBookingTelemetry = {
  loadTargetSlotMs: number;
  timeSlotsUpdateMs: number;
  targetSlotCount: number;
  releasedCount: number;
  bookedCount: number;
};

type RawTx = {
  $queryRaw: PrismaService['$queryRaw'];
};

/**
 * Booking Core Stable v1
 * Frozen after correctness/performance validation.
 * Modify cautiously.
 */
@Injectable()
export class TimeSlotService {
  private readonly logger = new Logger(TimeSlotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Regenerate free slots for one staff + one business-local date.
   * SAFE: only deletes `status='free'` rows, then inserts new free slots
   * that don't collide with existing held/booked rows.
   */
  async regenerateDay(
    businessId: string,
    staffId: string,
    dateYmd: string,
    timeZone: string,
  ): Promise<{ inserted: number; preserved: number; deletedRows: number }> {
    const ymd = dateYmd.slice(0, 10);
    const tz = ensureValidBusinessZone(resolveScheduleWallClockZone(timeZone));
    const stepMinutes = getAvailabilitySlotStepMinutes(this.config);

    const { startMs, endMs } = businessLocalDayBounds(tz, ymd);
    const dayStart = new Date(startMs);
    const dayEnd = new Date(endMs);

    const staffRow = await this.prisma.staff.findFirst({
      where: { id: staffId, businessId, isActive: true, deletedAt: null },
      include: {
        staffWorkingHours: true,
        staffWorkingHoursDateOverrides: {
          where: { date: { gte: dayStart, lt: dayEnd } },
        },
        staffBreaks: { where: { staffId } },
        staffBreakExceptions: {
          where: { staffId, date: { gte: dayStart, lt: dayEnd } },
        },
        staffServices: {
          where: { allowBooking: true },
          select: {
            durationMinutes: true,
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
        },
      },
    });

    if (!staffRow) {
      return { inserted: 0, preserved: 0, deletedRows: 0 };
    }

    const dow = businessLocalDayOfWeek(tz, ymd);
    const wh = resolveStaffWorkingHoursForBusinessLocalDay({
      ymd,
      timeZone: tz,
      weeklyRows: staffRow.staffWorkingHours,
      dateOverrides: staffRow.staffWorkingHoursDateOverrides ?? [],
    });

    if (!wh) {
      const deleted = await this.prisma.timeSlot.deleteMany({
        where: { staffId, date: new Date(ymd), status: 'free' },
      });
      return { inserted: 0, preserved: 0, deletedRows: deleted.count };
    }

    const minDuration = this.getMinEffectiveDuration(staffRow.staffServices);
    if (minDuration <= 0) {
      const deleted = await this.prisma.timeSlot.deleteMany({
        where: { staffId, date: new Date(ymd), status: 'free' },
      });
      return { inserted: 0, preserved: 0, deletedRows: deleted.count };
    }

    const weeklyBreaks: TimeRangeMin[] = (staffRow.staffBreaks ?? [])
      .filter((b: { dayOfWeek: number }) => b.dayOfWeek === dow)
      .map((b: { startTime: string; endTime: string }) => ({ start: hhmmToMinutes(b.startTime), end: hhmmToMinutes(b.endTime) }));
    const exBreaks: TimeRangeMin[] = (staffRow.staffBreakExceptions ?? [])
      .map((e: { startTime: string; endTime: string }) => ({ start: hhmmToMinutes(e.startTime), end: hhmmToMinutes(e.endTime) }));

    const { slotStartMinutes } = computeSlotStartsFromWorkingAndBusy(
      wh.startTime,
      wh.endTime,
      [...weeklyBreaks, ...exBreaks],
      minDuration,
      stepMinutes,
    );

    const dateObj = new Date(ymd);

    return this.prisma.$transaction(async (tx: {
      timeSlot: typeof this.prisma.timeSlot;
      appointment: typeof this.prisma.appointment;
      slotHold: typeof this.prisma.slotHold;
    }) => {
      const deleted = await tx.timeSlot.deleteMany({
        where: { staffId, date: dateObj, status: 'free' },
      });

      const existing = await tx.timeSlot.findMany({
        where: { staffId, date: dateObj, status: { in: ['held', 'booked'] } },
        select: { startTime: true },
      });
      const occupied = new Set<string>(
        existing.map((r: { startTime: string }) => r.startTime),
      );

      const now = new Date();
      const [appointments, activeHolds] = await Promise.all([
        tx.appointment.findMany({
          where: {
            staffId,
            businessId,
            status: {
              notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW],
            },
            startTime: { lt: dayEnd },
            endTime: { gt: dayStart },
          },
          select: { startTime: true, endTime: true },
        }),
        tx.slotHold.findMany({
          where: {
            staffId,
            businessId,
            consumedAt: null,
            expiresAt: { gt: now },
            startTime: { lt: dayEnd },
            endTime: { gt: dayStart },
          },
          select: { startTime: true, endTime: true },
        }),
      ]);

      this.addOccupiedFromWallIntervals({
        slotStartMinutes,
        occupied,
        minDuration,
        ymd,
        timeZone: tz,
        intervals: [
          ...appointments.map((a: { startTime: Date; endTime: Date }) => ({
            start: a.startTime,
            end: a.endTime,
          })),
          ...activeHolds.map((h: { startTime: Date; endTime: Date }) => ({
            start: h.startTime,
            end: h.endTime,
          })),
        ],
      });

      const newSlots = slotStartMinutes
        .filter((m) => !occupied.has(minutesToHhmm(m)))
        .map((m) => ({
          businessId,
          staffId,
          date: dateObj,
          startTime: minutesToHhmm(m),
          endMin: m + minDuration,
          durationMinutes: minDuration,
          status: 'free' as const,
        }));

      if (newSlots.length > 0) {
        await tx.timeSlot.createMany({ data: newSlots, skipDuplicates: true });
      }

      return {
        inserted: newSlots.length,
        preserved: occupied.size,
        deletedRows: deleted.count,
      };
    });
  }

  /**
   * Atomically hold N consecutive slots for a service.
   * Uses UPDATE ... WHERE status='free' and verifies all required slots were locked.
   * Returns the held slot IDs or null if race lost.
   */
  async holdSlots(params: {
    businessId: string;
    staffId: string;
    dateYmd: string;
    startTime: string;
    durationMinutes: number;
    holdId: string;
    stepMinutes?: number;
  }): Promise<{ heldCount: number; slotIds: string[] } | null> {
    const step = params.stepMinutes ?? getAvailabilitySlotStepMinutes(this.config);
    const slotsNeeded = Math.ceil(params.durationMinutes / step);
    const startMin = wallHhmmStringToMinuteOfDay(params.startTime.trim());
    const dateObj = new Date(params.dateYmd.slice(0, 10));

    const timeValues: string[] = [];
    for (let i = 0; i < slotsNeeded; i++) {
      timeValues.push(minutesToHhmm(startMin + i * step));
    }

    return this.prisma.$transaction(async (tx: { $queryRaw: typeof this.prisma.$queryRaw }) => {
      const updated = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "time_slots"
        SET "status" = 'held',
            "hold_id" = ${params.holdId},
            "updated_at" = now()
        WHERE "staff_id" = ${params.staffId}
          AND "date" = ${dateObj}
          AND "start_time" = ANY(${timeValues})
          AND "status" = 'free'
        RETURNING "id"
      `;

      if (updated.length !== slotsNeeded) {
        throw new Error(
          `SLOT_HOLD_RACE: needed ${slotsNeeded} free slots, got ${updated.length}`,
        );
      }

      return { heldCount: updated.length, slotIds: updated.map((r: { id: string }) => r.id) };
    });
  }

  /**
   * Transition held slots → booked (atomic). Called after appointment confirmed.
   */
  async bookSlots(holdId: string, appointmentId: string): Promise<number> {
    const result = await this.prisma.$executeRaw`
      UPDATE "time_slots"
      SET "status" = 'booked',
          "appointment_id" = ${appointmentId},
          "hold_id" = NULL,
          "updated_at" = now()
      WHERE "hold_id" = ${holdId}
        AND "status" = 'held'
    `;
    return result;
  }

  /**
   * Same as {@link bookSlots} but inside an open interactive transaction (appointment + ledger atomic).
   */
  async bookSlotsInTransaction(
    tx: { $executeRaw: typeof this.prisma.$executeRaw },
    holdId: string,
    appointmentId: string,
  ): Promise<number> {
    return tx.$executeRaw`
      UPDATE "time_slots"
      SET "status" = 'booked',
          "appointment_id" = ${appointmentId},
          "hold_id" = NULL,
          "updated_at" = now()
      WHERE "hold_id" = ${holdId}
        AND "status" = 'held'
    `;
  }

  /**
   * Release held slots back to free (hold expired or cancelled).
   */
  async releaseHold(holdId: string): Promise<number> {
    const result = await this.prisma.$executeRaw`
      UPDATE "time_slots"
      SET "status" = 'free',
          "hold_id" = NULL,
          "updated_at" = now()
      WHERE "hold_id" = ${holdId}
        AND "status" = 'held'
    `;
    return result;
  }

  /**
   * Bulk release: free all time_slots whose hold has expired in slot_holds (or been deleted).
   * Safe to run periodically or before each hold attempt.
   */
  async releaseExpiredHolds(): Promise<number> {
    const result = await this.prisma.$executeRaw`
      UPDATE "time_slots" ts
      SET "status" = 'free',
          "hold_id" = NULL,
          "updated_at" = now()
      WHERE ts."status" = 'held'
        AND ts."hold_id" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "slot_holds" sh
          WHERE sh.id = ts."hold_id"
            AND sh.consumed_at IS NULL
            AND sh.expires_at > now()
        )
    `;
    return result;
  }

  /**
   * Release booked slots back to free (appointment cancelled).
   */
  async cancelBooking(appointmentId: string): Promise<number> {
    const result = await this.prisma.$executeRaw`
      UPDATE "time_slots"
      SET "status" = 'free',
          "appointment_id" = NULL,
          "updated_at" = now()
      WHERE "appointment_id" = ${appointmentId}
        AND "status" = 'booked'
    `;
    return result;
  }

  /**
   * Reschedule: free old booked slots, then mark new time range as booked.
   * Called from `updateAppointment` (drag/resize) which bypasses the hold→book flow.
   */
  async rescheduleBooking(params: {
    appointmentId: string;
    staffId: string;
    dateYmd: string;
    startTime: string;
    durationMinutes: number;
    timeZone: string;
  }): Promise<RescheduleBookingTelemetry> {
    return this.rescheduleBookingInTransaction(this.prisma, params);
  }

  /**
   * Same as {@link rescheduleBooking} but inside an open interactive transaction.
   */
  async rescheduleBookingInTransaction(
    tx: RawTx,
    params: {
      appointmentId: string;
      staffId: string;
      dateYmd: string;
      startTime: string;
      durationMinutes: number;
      timeZone: string;
    },
  ): Promise<RescheduleBookingTelemetry> {
    const step = getAvailabilitySlotStepMinutes(this.config);
    const needed = Math.max(1, Math.ceil(params.durationMinutes / step));
    const startMin = wallHhmmStringToMinuteOfDay(params.startTime.trim());
    const dateObj = new Date(params.dateYmd.slice(0, 10));

    const timeValues: string[] = [];
    for (let i = 0; i < needed; i++) {
      timeValues.push(minutesToHhmm(startMin + i * step));
    }

    const tUpdate0 = Date.now();
    const [result] = await tx.$queryRaw<
      Array<{ releasedCount: number; bookedCount: number }>
    >`
      WITH released AS (
        UPDATE "time_slots"
        SET "status" = 'free',
            "appointment_id" = NULL,
            "hold_id" = NULL,
            "updated_at" = now()
        WHERE "appointment_id" = ${params.appointmentId}
          AND "status" = 'booked'
        RETURNING 1
      ),
      booked AS (
        UPDATE "time_slots"
        SET "status" = 'booked',
            "appointment_id" = ${params.appointmentId},
            "hold_id" = NULL,
            "updated_at" = now()
        WHERE "staff_id" = ${params.staffId}
          AND "date" = ${dateObj}
          AND "start_time" = ANY(${timeValues})
          AND "status" = 'free'
        RETURNING 1
      )
      SELECT
        COALESCE((SELECT COUNT(*) FROM released), 0)::int AS "releasedCount",
        COALESCE((SELECT COUNT(*) FROM booked), 0)::int AS "bookedCount"
    `;

    return {
      loadTargetSlotMs: 0,
      timeSlotsUpdateMs: Date.now() - tUpdate0,
      targetSlotCount: needed,
      releasedCount: result?.releasedCount ?? 0,
      bookedCount: result?.bookedCount ?? 0,
    };
  }

  /**
   * O(1) availability read. ~5ms.
   */
  async getFreeSlots(
    staffId: string,
    dateYmd: string,
  ): Promise<string[]> {
    const rows = await this.prisma.timeSlot.findMany({
      where: {
        staffId,
        date: new Date(dateYmd.slice(0, 10)),
        status: 'free',
      },
      select: { startTime: true },
      orderBy: { endMin: 'asc' },
    });
    return rows.map((r) => r.startTime);
  }

  /**
   * Free starts for which {@link holdSlots} can lock `ceil(durationMinutes/step)` consecutive cells.
   * Without this, GET /availability ignores service duration when `USE_TIME_SLOTS=1`.
   */
  async getFreeSlotsForBookingBlock(
    staffId: string,
    dateYmd: string,
    durationMinutes: number,
  ): Promise<string[]> {
    const step = getAvailabilitySlotStepMinutes(this.config);
    const needed = Math.max(1, Math.ceil(durationMinutes / step));
    const rows = await this.prisma.timeSlot.findMany({
      where: {
        staffId,
        date: new Date(dateYmd.slice(0, 10)),
        status: 'free',
      },
      select: { startTime: true },
    });
    const free = new Set(rows.map((r) => r.startTime));
    const candidates = [...free].sort(
      (a, b) => wallHhmmStringToMinuteOfDay(a) - wallHhmmStringToMinuteOfDay(b),
    );
    const out: string[] = [];
    for (const st of candidates) {
      const m0 = wallHhmmStringToMinuteOfDay(st);
      let ok = true;
      for (let i = 0; i < needed; i++) {
        if (!free.has(minutesToHhmm(m0 + i * step))) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(st);
    }
    return out;
  }

  /**
   * Initial seed: regenerate time_slots for all active staff in a business, N days ahead.
   * Call once after enabling USE_TIME_SLOTS, or from a cron/startup hook.
   */
  async seedBusinessDays(
    businessId: string,
    timeZone: string,
    daysAhead: number = 14,
  ): Promise<{ staffCount: number; totalInserted: number }> {
    const tz = ensureValidBusinessZone(resolveScheduleWallClockZone(timeZone));
    const staffList = await this.prisma.staff.findMany({
      where: { businessId, isActive: true, deletedAt: null },
      select: { id: true },
    });

    const today = DateTime.now().setZone(tz).toISODate()!;
    let totalInserted = 0;

    for (const staff of staffList) {
      for (let i = 0; i < daysAhead; i++) {
        const ymd = DateTime.fromISO(today, { zone: tz })
          .plus({ days: i })
          .toISODate()!;
        const { inserted } = await this.regenerateDay(businessId, staff.id, ymd, tz);
        totalInserted += inserted;
      }
    }

    return { staffCount: staffList.length, totalInserted };
  }

  /**
   * Slot starts whose bookable window [m, m + minDuration) overlaps a real appointment
   * or active hold must not be recreated as `free` (keeps GET /availability aligned with holds).
   */
  private addOccupiedFromWallIntervals(params: {
    slotStartMinutes: number[];
    occupied: Set<string>;
    minDuration: number;
    ymd: string;
    timeZone: string;
    intervals: Array<{ start: Date; end: Date }>;
  }): void {
    const dayBase = DateTime.fromISO(params.ymd, { zone: params.timeZone }).startOf('day');
    const dayEndExcl = dayBase.plus({ days: 1 });

    for (const iv of params.intervals) {
      const s = DateTime.fromJSDate(iv.start).setZone(params.timeZone);
      const e = DateTime.fromJSDate(iv.end).setZone(params.timeZone);
      const clipStart = s > dayBase ? s : dayBase;
      const clipEnd = e < dayEndExcl ? e : dayEndExcl;
      if (clipStart >= clipEnd) continue;

      const startMin = clipStart.diff(dayBase, 'minutes').minutes;
      const endMin = clipEnd.diff(dayBase, 'minutes').minutes;

      for (const m of params.slotStartMinutes) {
        if (m < endMin && m + params.minDuration > startMin) {
          params.occupied.add(minutesToHhmm(m));
        }
      }
    }
  }

  private getMinEffectiveDuration(
    staffServices: Array<{
      durationMinutes: number;
      service: {
        durationMinutes: number;
        bufferBeforeMinutes: number | null;
        bufferAfterMinutes: number | null;
        deletedAt: Date | null;
        isActive: boolean;
      };
    }>,
  ): number {
    let min = Infinity;
    for (const ss of staffServices) {
      if (ss.service.deletedAt || !ss.service.isActive) continue;
      const core = ss.durationMinutes > 0 ? ss.durationMinutes : ss.service.durationMinutes;
      const eff = core + (ss.service.bufferBeforeMinutes ?? 0) + (ss.service.bufferAfterMinutes ?? 0);
      if (eff < min) min = eff;
    }
    return min === Infinity ? 0 : Math.max(1, min);
  }
}
