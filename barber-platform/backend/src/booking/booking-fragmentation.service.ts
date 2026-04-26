import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getAvailabilitySlotStepMinutes } from '../common/availability-slot-interval';
import {
  businessLocalDayBounds,
  businessLocalDayOfWeek,
  resolveScheduleWallClockZone,
  resolveStaffWorkingHoursForBusinessLocalDay,
} from '../common/business-local-time';
import {
  appointmentsToMinuteIntervalsOnBusinessLocalDay,
  slotHoldToBusyInterval,
  type MinuteInterval,
} from '../availability/interval-availability.engine';
import { utcNowJsDate } from '../common/time';
import { hhmmToMinutes, subtractRanges, type TimeRangeMin } from '../availability/simple-availability.engine';
import {
  pickTopAlternativeSlotMinutes,
  validateBookingAgainstFragmentation,
} from '../availability/slot-fragmentation';

type AppointmentSpan = { startTime: Date; endTime: Date };

export type BookingFragmentationContext = {
  afterBreaks: MinuteInterval[];
  busyMin: MinuteInterval[];
  dayStartUtcMs: number;
  workingWindow: MinuteInterval;
  breaksAndExceptions: MinuteInterval[];
  stepMinutes: number;
};

@Injectable()
export class BookingFragmentationService {
  private readonly logger = new Logger(BookingFragmentationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Serializable booking transaction: reject if fragmentation score fails (same rules as GET availability ranking).
   */
  async enforceBeforeCreateInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      businessId: string;
      staffId: string;
      dateYmd: string;
      startTime: Date;
      durationMinutes: number;
    },
  ): Promise<void> {
    if (this.config.get<string>('AVAILABILITY_FRAGMENTATION_ENFORCE') === '0') {
      return;
    }

    const ctx = await this.loadFragmentationContext(tx, input.businessId, input.staffId, input.dateYmd);
    if (!ctx) {
      return;
    }

    const candidateStartMin = Math.round(
      (input.startTime.getTime() - ctx.dayStartUtcMs) / 60_000,
    );
    const strictMode = this.config.get<string>('AVAILABILITY_FRAGMENTATION_STRICT') === '1';
    const minScoreThreshold = this.parseMinScoreThreshold();
    const minServiceDuration = this.resolveMinServiceDuration(input.durationMinutes);

    const { allowed, score } = validateBookingAgainstFragmentation({
      freeSegments: ctx.afterBreaks,
      bookings: ctx.busyMin,
      candidateStart: candidateStartMin,
      duration: input.durationMinutes,
      minServiceDuration,
      strictMode,
      minScoreThreshold,
    });

    if (allowed) {
      return;
    }

    this.logger.debug(
      `[Booking] Fragmentation rejection score=${score} strict=${strictMode} minScore=${minScoreThreshold}`,
    );

    const ymd = input.dateYmd.slice(0, 10);
    const altMinutes = pickTopAlternativeSlotMinutes(
      {
        dateStr: ymd,
        workingWindow: ctx.workingWindow,
        breaksAndExceptions: ctx.breaksAndExceptions,
        busyFromBookings: ctx.busyMin,
        serviceDurationMinutes: input.durationMinutes,
        stepMinutes: ctx.stepMinutes,
        dayStartUtcMs: ctx.dayStartUtcMs,
      },
      {
        afterBreaks: ctx.afterBreaks,
        durationMinutes: input.durationMinutes,
        minServiceDuration,
        strictMode,
        minScoreThreshold,
        excludeStartMin: candidateStartMin,
        topN: 3,
        dayStartUtcMs: ctx.dayStartUtcMs,
      },
    );

    const suggestedStartTimes = altMinutes.map(minutesToHhMmLocal);

    throw new HttpException(
      {
        message: 'Selected time is no longer optimal. Please choose another time.',
        suggestedStartTimes,
      },
      HttpStatus.CONFLICT,
    );
  }

  private parseMinScoreThreshold(): number {
    const raw = this.config.get<string>('AVAILABILITY_FRAGMENTATION_MIN_SCORE', '0');
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  }

  private resolveMinServiceDuration(fallbackDuration: number): number {
    const raw = this.config.get<string>('AVAILABILITY_FRAGMENTATION_MIN_SERVICE_MINUTES', '');
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1) return n;
    return Math.max(1, Math.floor(fallbackDuration));
  }

  private async loadFragmentationContext(
    tx: Prisma.TransactionClient,
    businessId: string,
    staffId: string,
    dateYmd: string,
  ): Promise<BookingFragmentationContext | null> {
    const ymd = dateYmd.slice(0, 10);
    const biz = await tx.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    const timeZone = resolveScheduleWallClockZone(biz?.timezone);
    const dow = businessLocalDayOfWeek(timeZone, ymd);

    const { startMs: dayStartUtcMs, endMs: dayEndExclusiveMs } = businessLocalDayBounds(
      timeZone,
      ymd,
    );
    const dayStart = new Date(dayStartUtcMs);
    const dayEndExclusive = new Date(dayEndExclusiveMs);

    const now = utcNowJsDate();

    const [weeklyHours, dateOverrides, weeklyBreaks, dateBreaks, appointments, activeHolds] =
      await Promise.all([
      tx.staffWorkingHours.findMany({ where: { staffId } }),
      tx.staffWorkingHoursDateOverride.findMany({
        where: { staffId, date: { gte: dayStart, lt: dayEndExclusive } },
      }),
      tx.staffBreak.findMany({ where: { staffId, dayOfWeek: dow } }),
      tx.staffBreakException.findMany({
        where: {
          staffId,
          date: { gte: dayStart, lt: dayEndExclusive },
        },
      }),
      tx.appointment.findMany({
        where: {
          staffId,
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startTime: { lt: dayEndExclusive },
          endTime: { gt: dayStart },
        },
        select: { startTime: true, endTime: true },
      }),
      tx.slotHold.findMany({
        where: {
          businessId,
          staffId,
          consumedAt: null,
          expiresAt: { gt: now },
          startTime: { lt: dayEndExclusive },
          endTime: { gt: dayStart },
        },
        select: { startTime: true, endTime: true },
      }),
    ]);

    const whResolved = resolveStaffWorkingHoursForBusinessLocalDay({
      ymd,
      timeZone,
      weeklyRows: weeklyHours,
      dateOverrides,
    });
    if (!whResolved) return null;

    const weekly: TimeRangeMin[] = weeklyBreaks.map((b) => ({
      start: hhmmToMinutes(b.startTime),
      end: hhmmToMinutes(b.endTime),
    }));
    const exMin: TimeRangeMin[] = dateBreaks.map((e) => ({
      start: hhmmToMinutes(e.startTime),
      end: hhmmToMinutes(e.endTime),
    }));

    const whStart = hhmmToMinutes(whResolved.startTime);
    const whEnd = hhmmToMinutes(whResolved.endTime);

    /** Same construction as {@link ComputedAvailabilityService.computeOneDaySlots} (matches ranking `freeSegments`). */
    const afterBreaks = subtractRanges(
      { start: whStart, end: whEnd },
      [...weekly, ...exMin],
    );
    const breaksAndExceptions: MinuteInterval[] = [...weekly, ...exMin];

    const apptsDay = (appointments as AppointmentSpan[]).filter(
      (a) =>
        a.startTime.getTime() < dayEndExclusiveMs && a.endTime.getTime() > dayStartUtcMs,
    );
    const holdsDay: AppointmentSpan[] = activeHolds
      .map(slotHoldToBusyInterval)
      .filter(
        (h: AppointmentSpan) =>
          h.startTime.getTime() < dayEndExclusiveMs && h.endTime.getTime() > dayStartUtcMs,
      );
    const busyMin = appointmentsToMinuteIntervalsOnBusinessLocalDay(
      [...apptsDay, ...holdsDay],
      ymd,
      timeZone,
    );

    const stepMinutes = getAvailabilitySlotStepMinutes(this.config);

    return {
      afterBreaks,
      busyMin,
      dayStartUtcMs,
      workingWindow: { start: whStart, end: whEnd },
      breaksAndExceptions,
      stepMinutes,
    };
  }
}

function minutesToHhMmLocal(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
