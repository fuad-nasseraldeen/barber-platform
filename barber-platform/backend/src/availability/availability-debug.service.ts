import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { getAvailabilitySlotStepMinutes } from '../common/availability-slot-interval';
import {
  businessLocalDayBounds,
  businessLocalDayOfWeek,
  businessLocalYmdFromJsDate,
  type HolidayCheckRow,
  isCalendarDayHolidayInZone,
  resolveBusinessTimeZone,
  resolveStaffWorkingHoursForBusinessLocalDay,
} from '../common/business-local-time';
import {
  hhmmToMinutes,
  minutesToHhmm,
  subtractRanges,
  type TimeRangeMin,
} from './simple-availability.engine';
import {
  appointmentsToMinuteIntervalsOnBusinessLocalDay,
  generateSlotsFromInterval,
  mergeMinuteIntervals,
  subtractIntervals,
  type MinuteInterval,
} from './interval-availability.engine';
import {
  debugAvailabilityDay,
  type DebugAvailabilityDayResult,
} from './debug-availability-day.runner';

type BookingRow = { startTime: Date; endTime: Date; id?: string; status?: string };

const LOG_PREFIX = '[debugDayAvailability]';

/** Slot geometry invariant failed: segment length sufficient but zero generated starts. */
export class InternalInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InternalInvariantError';
  }
}

/**
 * Format an absolute instant as calendar + wall clock in the business zone.
 * Never uses Date#toISOString().
 */
function fmtInstantInZone(d: Date, zone: string): string {
  const dt = DateTime.fromJSDate(d, { zone: 'utc' }).setZone(zone);
  return dt.toFormat('yyyy-MM-dd HH:mm');
}

function minIntervalToHhmm(i: TimeRangeMin): { start: string; end: string } {
  return {
    start: minutesToHhmm(i.start),
    end: minutesToHhmm(i.end),
  };
}

@Injectable()
export class AvailabilityDebugService {
  private readonly logger = new Logger(AvailabilityDebugService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Deep debug log for one staff + business-local calendar day.
   * All clock outputs use `business.timezone` (Luxon). No toISOString in logs.
   */
  async debugDayAvailability(
    staffId: string,
    dateYmd: string,
    opts?: {
      expectedBusinessId?: string;
      probeServiceDurationMinutes?: number;
      bufferBefore?: number;
      bufferAfter?: number;
    },
  ): Promise<void> {
    const ymd = dateYmd.slice(0, 10);
    const probeDur =
      opts?.probeServiceDurationMinutes != null && opts.probeServiceDurationMinutes >= 1
        ? Math.floor(opts.probeServiceDurationMinutes)
        : 100;
    const bufB = opts?.bufferBefore ?? 0;
    const bufA = opts?.bufferAfter ?? 0;
    const effectiveBlock = probeDur + bufB + bufA;
    const stepMinutes = getAvailabilitySlotStepMinutes(this.config);

    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId, deletedAt: null },
      select: {
        id: true,
        businessId: true,
        isActive: true,
        firstName: true,
        lastName: true,
        business: { select: { timezone: true } },
        staffWorkingHours: true,
        staffBreaks: true,
        staffBreakExceptions: true,
        staffTimeOff: {
          where: { status: 'APPROVED' },
        },
      },
    });

    if (!staff) {
      throw new BadRequestException(`Staff not found: ${staffId}`);
    }
    if (opts?.expectedBusinessId != null && staff.businessId !== opts.expectedBusinessId) {
      throw new ForbiddenException('Staff does not belong to your business');
    }

    const timeZone = resolveBusinessTimeZone(staff.business?.timezone);
    const { startMs: dayStartMs, endMs: dayEndMs } = businessLocalDayBounds(timeZone, ymd);
    const dayStartUtcMs = dayStartMs;

    this.logLine(`timezone=${timeZone} date=${ymd} staff=${staffId} (${staff.firstName} ${staff.lastName})`);
    this.logLine(`probe effectiveBlockMinutes=${effectiveBlock} (service=${probeDur} + before=${bufB} + after=${bufA}) stepMinutes=${stepMinutes}`);

    const rangeStart = new Date(dayStartMs);
    const rangeEndExclusive = new Date(dayEndMs);

    const staffWorkingHoursDateOverrides = await this.prisma.staffWorkingHoursDateOverride.findMany({
      where: {
        staffId,
        date: { gte: rangeStart, lt: rangeEndExclusive },
      },
    });

    const [appointments, holidayRows] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          staffId,
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startTime: { lt: rangeEndExclusive },
          endTime: { gt: rangeStart },
        },
        select: { id: true, status: true, startTime: true, endTime: true },
      }),
      this.prisma.businessHoliday.findMany({
        where: {
          businessId: staff.businessId,
          OR: [
            { isRecurring: false, date: { gte: rangeStart, lt: rangeEndExclusive } },
            { isRecurring: true },
          ],
        },
        select: { date: true, isRecurring: true },
      }),
    ]);

    const holidays = holidayRows as HolidayCheckRow[];

    if (isCalendarDayHolidayInZone(ymd, holidays, timeZone)) {
      this.logLine('BLOCKED: business holiday on this local date');
      return;
    }

    const dayStart = rangeStart;
    const dayEnd = rangeEndExclusive;
    const timeOffToday = staff.staffTimeOff.filter(
      (t) => t.startDate < dayEnd && t.endDate >= dayStart,
    );
    for (const t of timeOffToday) {
      if (t.isAllDay || (t.startTime && t.endTime)) {
        this.logLine('BLOCKED: staff time off (APPROVED) intersects this day');
        return;
      }
    }

    const dow = businessLocalDayOfWeek(timeZone, ymd);
    const wh = resolveStaffWorkingHoursForBusinessLocalDay({
      ymd,
      timeZone,
      weeklyRows: staff.staffWorkingHours,
      dateOverrides: staffWorkingHoursDateOverrides,
    });
    if (!wh) {
      this.logLine(`NO working hours for date=${ymd} (dow=${dow}, 0=Sun..6=Sat)`);
      return;
    }

    const workingHoursLog = [{ start: wh.startTime, end: wh.endTime }];
    this.logSection('1. Working hours (DB wall time, business local)', workingHoursLog);

    const breaksWeekly = staff.staffBreaks
      .filter((b) => b.dayOfWeek === dow)
      .map((b) => ({ start: b.startTime, end: b.endTime }));
    const exToday = staff.staffBreakExceptions.filter(
      (e) => businessLocalYmdFromJsDate(timeZone, e.date) === ymd,
    );
    const breaksException = exToday.map((e) => ({ start: e.startTime, end: e.endTime }));
    const breaksLog = [...breaksWeekly, ...breaksException];
    this.logSection('2. Breaks (weekly for dow + exceptions this date)', breaksLog);

    const rawBookingsLog = appointments.map((a) => ({
      id: a.id,
      status: a.status,
      startTime_db_local_display: fmtInstantInZone(a.startTime, timeZone),
      endTime_db_local_display: fmtInstantInZone(a.endTime, timeZone),
      startTime_getTime_ms: a.startTime.getTime(),
      endTime_getTime_ms: a.endTime.getTime(),
    }));
    this.logSection('3. Bookings RAW from DB (no pipeline) + same instants as business-local wall', rawBookingsLog);

    const appointmentsInDay: BookingRow[] = appointments.filter(
      (a) => a.startTime.getTime() < dayEndMs && a.endTime.getTime() > dayStartMs,
    );

    const busyMin = appointmentsToMinuteIntervalsOnBusinessLocalDay(
      appointmentsInDay,
      ymd,
      timeZone,
    );
    const parsedLog = busyMin.map((b) => ({
      startMin: b.start,
      endMin: b.end,
      start: minutesToHhmm(b.start),
      end: minutesToHhmm(b.end),
    }));
    this.logSection('4. Parsed bookings → minute intervals [start,end) from LOCAL midnight', parsedLog);

    const whStart = hhmmToMinutes(wh.startTime);
    const whEnd = hhmmToMinutes(wh.endTime);
    const weeklyMin: TimeRangeMin[] = staff.staffBreaks
      .filter((b) => b.dayOfWeek === dow)
      .map((b) => ({ start: hhmmToMinutes(b.startTime), end: hhmmToMinutes(b.endTime) }));
    const exMin: TimeRangeMin[] = exToday.map((e) => ({
      start: hhmmToMinutes(e.startTime),
      end: hhmmToMinutes(e.endTime),
    }));
    /* Same as computeAvailability: merge breaks before carving the working window. */
    const afterBreaks = subtractRanges(
      { start: whStart, end: whEnd },
      mergeMinuteIntervals([...weeklyMin, ...exMin]),
    );
    const freeAfterBookings = subtractIntervals(afterBreaks, busyMin);

    const freeLog = freeAfterBookings.map((s) => {
      const dur = Math.max(0, s.end - s.start);
      return {
        ...minIntervalToHhmm(s),
        startMin: s.start,
        endMin: s.end,
        durationMinutes: dur,
        maxServiceMinutesThatFitsNoStep: dur,
      };
    });
    this.logSection('5. Free intervals AFTER subtract breaks + bookings', freeLog);

    this.logLine('6. Per free interval: duration & theoretical max contiguous length');
    for (const s of freeAfterBookings) {
      const dur = s.end - s.start;
      this.logLine(
        `   [${minutesToHhmm(s.start)}–${minutesToHhmm(s.end)}) duration=${dur} min — max contiguous block (naive)=${dur} min`,
      );
    }

    for (const seg of freeAfterBookings) {
      const segLen = seg.end - seg.start;
      if (segLen >= effectiveBlock) {
        const n = this.countStartsInSegment(seg, effectiveBlock, stepMinutes);
        if (n === 0) {
          throw new InternalInvariantError(
            `FREE INTERVAL INVARIANT VIOLATION: segment [${minutesToHhmm(seg.start)},${minutesToHhmm(
              seg.end,
            )}) has duration ${segLen} >= effectiveBlock ${effectiveBlock} and step ${stepMinutes}, but generated 0 starts. Timezone or slot loop bug.`,
          );
        }
      }
    }

    this.logLine(`7. Service block = ${effectiveBlock} minutes (probe ${probeDur} + buffers)`);
    const allStarts: string[] = [];
    for (const seg of freeAfterBookings) {
      const segLen = seg.end - seg.start;
      if (segLen < effectiveBlock) {
        this.logLine(
          `   segment [${minutesToHhmm(seg.start)}–${minutesToHhmm(seg.end)}) duration=${segLen} < ${effectiveBlock} → REJECTED (interval too small for this service block)`,
        );
        continue;
      }
      const wins = generateSlotsFromInterval(seg, effectiveBlock, stepMinutes, ymd, dayStartUtcMs);
      const hhmmList = wins.map((w) => fmtInstantInZone(w.start, timeZone).slice(11)); // "HH:mm"
      allStarts.push(...hhmmList);
      this.logLine(
        `   segment [${minutesToHhmm(seg.start)}–${minutesToHhmm(seg.end)}): ${wins.length} valid start(s) at step ${stepMinutes}: ${hhmmList.join(', ')}`,
      );
    }
    if (allStarts.length === 0) {
      this.logLine('   RESULT: no valid start times for this service block (see REJECTED lines above).');
    } else {
      this.logLine(`   ALL valid starts (${allStarts.length}): ${allStarts.join(', ')}`);
    }
  }

  private countStartsInSegment(seg: MinuteInterval, dur: number, step: number): number {
    const segEnd = Math.trunc(seg.end);
    const segStart = Math.trunc(seg.start);
    const d = Math.max(1, Math.floor(dur));
    if (segEnd <= segStart || segStart + d > segEnd) return 0;
    let n = 0;
    let t = Math.ceil(segStart / step) * step;
    for (;; t += step) {
      if (t + d > segEnd) break;
      n++;
    }
    return n;
  }

  private logSection(title: string, payload: unknown): void {
    this.logLine(title);
    try {
      this.logger.log(`${LOG_PREFIX}\n${JSON.stringify(payload, null, 2)}`);
    } catch {
      this.logger.log(`${LOG_PREFIX} ${String(payload)}`);
    }
  }

  private logLine(msg: string): void {
    this.logger.log(`${LOG_PREFIX} ${msg}`);
  }

  /**
   * Full structured debug payload (business timezone wall times). Same math as offered-slot pipeline.
   */
  async debugAvailabilityDayStructured(
    staffId: string,
    date: string,
    serviceDuration: number,
    opts?: {
      bufferBefore?: number;
      bufferAfter?: number;
      expectedBusinessId?: string;
    },
  ): Promise<DebugAvailabilityDayResult> {
    return debugAvailabilityDay(this.prisma, this.config, {
      staffId,
      date: date.slice(0, 10),
      serviceDurationMinutes: serviceDuration,
      bufferBefore: opts?.bufferBefore,
      bufferAfter: opts?.bufferAfter,
      expectedBusinessId: opts?.expectedBusinessId,
    });
  }
}
