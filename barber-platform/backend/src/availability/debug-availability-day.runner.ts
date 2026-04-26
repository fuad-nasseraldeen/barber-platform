/**
 * Read-only debug: same interval pipeline as production availability (observe; do not alter engine).
 * All wall-clock strings are in the business IANA timezone. No Date#toISOString() for formatting.
 */
import { ConfigService } from '@nestjs/config';
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
  formatBusinessTime,
  getBusinessNow,
  ensureValidBusinessZone,
} from '../common/time-engine';
import {
  hhmmToMinutes,
  minutesToHhmm,
  subtractRanges,
  type TimeRangeMin,
} from './simple-availability.engine';
import { mergeMinuteIntervals } from './interval-availability.engine';
import {
  appointmentsToMinuteIntervalsOnBusinessLocalDay,
  generateSlotsFromInterval,
  subtractIntervals,
  countStartsInSegments,
} from './interval-availability.engine';

/** Public debug API — matches product language. */
export type DebugAvailabilityDayInput = {
  staffId: string;
  date: string;
  serviceDurationMinutes: number;
  bufferBefore?: number;
  bufferAfter?: number;
  /** Optional: multi-tenant guard when exposing via HTTP */
  expectedBusinessId?: string;
};

/**
 * JSON-serializable report. Required analysis fields per spec;
 * `timezone` / `blocked` / `bookingsExcludedFromPipeline` explain context without hiding truth.
 */
export type DebugAvailabilityDayReport = {
  timezone: string;
  staffId: string;
  date: string;
  serviceDurationMinutes: number;
  /** Service + buffers (same as GET /availability effective block when buffers used). */
  effectiveBlockMinutes: number;
  stepMinutes: number;
  bufferBefore: number;
  bufferAfter: number;
  blocked: null | { code: string; message: string };
  businessNow: string;
  workingHours: Array<{ start: string; end: string }>;
  breaks: Array<{ start: string; end: string }>;
  /** Every appointment row intersecting the day window (all statuses). */
  bookingsRaw: Array<{ startTime: string; endTime: string; id: string; status: string }>;
  /** IDs/statuses excluded from subtraction (never silent). */
  bookingsExcludedFromPipeline: Array<{ id: string; status: string; reason: string }>;
  bookingsParsed: Array<{ start: string; end: string }>;
  freeIntervals: Array<{ start: string; end: string; durationMinutes: number }>;
  rejectedIntervals: Array<{
    start: string;
    end: string;
    durationMinutes: number;
    reason: string;
  }>;
  validSlots: Array<{ start: string; end: string }>;
};

export class DebugAvailabilityInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DebugAvailabilityInvariantError';
  }
}

function minToHhmmPair(i: TimeRangeMin): { start: string; end: string } {
  return { start: minutesToHhmm(i.start), end: minutesToHhmm(i.end) };
}

/**
 * Full truth for one staff + business-local calendar day.
 */
export async function debugAvailabilityDay(
  prisma: PrismaService,
  config: ConfigService,
  input: DebugAvailabilityDayInput,
): Promise<DebugAvailabilityDayReport> {
  const ymd = input.date.slice(0, 10);
  const serviceDur =
    input.serviceDurationMinutes >= 1 ? Math.floor(input.serviceDurationMinutes) : 30;
  const bufB = input.bufferBefore ?? 0;
  const bufA = input.bufferAfter ?? 0;
  const effectiveBlock = serviceDur + bufB + bufA;
  const stepMinutes = getAvailabilitySlotStepMinutes(config);

  const out: DebugAvailabilityDayReport = {
    timezone: '',
    staffId: input.staffId,
    date: ymd,
    serviceDurationMinutes: serviceDur,
    effectiveBlockMinutes: effectiveBlock,
    stepMinutes,
    bufferBefore: bufB,
    bufferAfter: bufA,
    blocked: null,
    businessNow: '',
    workingHours: [],
    breaks: [],
    bookingsRaw: [],
    bookingsExcludedFromPipeline: [],
    bookingsParsed: [],
    freeIntervals: [],
    rejectedIntervals: [],
    validSlots: [],
  };

  const staff = await prisma.staff.findUnique({
    where: { id: input.staffId, deletedAt: null },
    select: {
      id: true,
      businessId: true,
      business: { select: { timezone: true } },
      staffWorkingHours: true,
      staffBreaks: true,
      staffBreakExceptions: true,
      staffTimeOff: { where: { status: 'APPROVED' } },
    },
  });

  if (!staff) {
    out.blocked = { code: 'STAFF_NOT_FOUND', message: `Staff not found: ${input.staffId}` };
    out.rejectedIntervals.push({
      start: '00:00',
      end: '24:00',
      durationMinutes: 24 * 60,
      reason: 'staff_not_found',
    });
    return out;
  }
  if (input.expectedBusinessId != null && staff.businessId !== input.expectedBusinessId) {
    out.blocked = { code: 'FORBIDDEN', message: 'Staff does not belong to this business' };
    out.rejectedIntervals.push({
      start: '00:00',
      end: '24:00',
      durationMinutes: 24 * 60,
      reason: 'forbidden_wrong_business',
    });
    return out;
  }

  const timeZone = ensureValidBusinessZone(resolveBusinessTimeZone(staff.business?.timezone));
  out.timezone = timeZone;
  out.businessNow = getBusinessNow(timeZone).toFormat('yyyy-MM-dd HH:mm');

  const { startMs: dayStartMs, endMs: dayEndMs } = businessLocalDayBounds(timeZone, ymd);
  const rangeStart = new Date(dayStartMs);
  const rangeEndExclusive = new Date(dayEndMs);

  const staffWorkingHoursDateOverrides = await prisma.staffWorkingHoursDateOverride.findMany({
    where: {
      staffId: input.staffId,
      date: { gte: rangeStart, lt: rangeEndExclusive },
    },
  });

  const appointmentsAll = await prisma.appointment.findMany({
    where: {
      staffId: input.staffId,
      startTime: { lt: rangeEndExclusive },
      endTime: { gt: rangeStart },
    },
    select: { id: true, status: true, startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  });

  out.bookingsRaw = appointmentsAll.map((a) => ({
    id: a.id,
    status: a.status,
    startTime: formatBusinessTime(a.startTime, timeZone),
    endTime: formatBusinessTime(a.endTime, timeZone),
  }));

  for (const a of appointmentsAll) {
    if (['CANCELLED', 'NO_SHOW'].includes(a.status)) {
      out.bookingsExcludedFromPipeline.push({
        id: a.id,
        status: a.status,
        reason: 'status_not_subtracted_in_availability_pipeline',
      });
    }
  }

  const activeBlocking = appointmentsAll.filter(
    (a) => !['CANCELLED', 'NO_SHOW'].includes(a.status),
  );

  const holidayRows = (await prisma.businessHoliday.findMany({
    where: {
      businessId: staff.businessId,
      OR: [
        { isRecurring: false, date: { gte: rangeStart, lt: rangeEndExclusive } },
        { isRecurring: true },
      ],
    },
    select: { date: true, isRecurring: true },
  })) as HolidayCheckRow[];

  if (isCalendarDayHolidayInZone(ymd, holidayRows, timeZone)) {
    out.blocked = { code: 'BUSINESS_HOLIDAY', message: 'Business holiday on this local date' };
    out.rejectedIntervals.push({
      start: '00:00',
      end: '24:00',
      durationMinutes: 24 * 60,
      reason: 'business_holiday',
    });
    return out;
  }

  const dayStart = rangeStart;
  const dayEnd = rangeEndExclusive;
  const timeOffToday = staff.staffTimeOff.filter(
    (t) => t.startDate < dayEnd && t.endDate >= dayStart,
  );
  for (const t of timeOffToday) {
    if (t.isAllDay || (t.startTime && t.endTime)) {
      out.blocked = { code: 'STAFF_TIME_OFF', message: 'Approved time off intersects this day' };
      out.rejectedIntervals.push({
        start: '00:00',
        end: '24:00',
        durationMinutes: 24 * 60,
        reason: 'staff_time_off',
      });
      return out;
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
    out.blocked = {
      code: 'NO_WORKING_HOURS',
      message: `No working hours for date=${ymd} (dow=${dow}, 0=Sun..6=Sat)`,
    };
    out.rejectedIntervals.push({
      start: '00:00',
      end: '24:00',
      durationMinutes: 24 * 60,
      reason: 'no_working_hours_for_day',
    });
    return out;
  }

  out.workingHours = [{ start: wh.startTime, end: wh.endTime }];

  const breaksWeekly = staff.staffBreaks
    .filter((b) => b.dayOfWeek === dow)
    .map((b) => ({ start: b.startTime, end: b.endTime }));
  const exToday = staff.staffBreakExceptions.filter(
    (e) => businessLocalYmdFromJsDate(timeZone, e.date) === ymd,
  );
  const breaksException = exToday.map((e) => ({ start: e.startTime, end: e.endTime }));
  out.breaks = [...breaksWeekly, ...breaksException];

  const appointmentsInDay = activeBlocking.filter(
    (a) => a.startTime.getTime() < dayEndMs && a.endTime.getTime() > dayStartMs,
  );

  const busyMin = appointmentsToMinuteIntervalsOnBusinessLocalDay(
    appointmentsInDay,
    ymd,
    timeZone,
  );
  out.bookingsParsed = busyMin.map((b) => minToHhmmPair(b));

  const whStart = hhmmToMinutes(wh.startTime);
  const whEnd = hhmmToMinutes(wh.endTime);
  const weeklyMin: TimeRangeMin[] = staff.staffBreaks
    .filter((b) => b.dayOfWeek === dow)
    .map((b) => ({ start: hhmmToMinutes(b.startTime), end: hhmmToMinutes(b.endTime) }));
  const exMin: TimeRangeMin[] = exToday.map((e) => ({
    start: hhmmToMinutes(e.startTime),
    end: hhmmToMinutes(e.endTime),
  }));

  const afterBreaks = subtractRanges(
    { start: whStart, end: whEnd },
    mergeMinuteIntervals([...weeklyMin, ...exMin]),
  );
  const freeAfterBookings = subtractIntervals(afterBreaks, busyMin);

  for (const seg of freeAfterBookings) {
    const dur = Math.max(0, seg.end - seg.start);
    out.freeIntervals.push({
      ...minToHhmmPair(seg),
      durationMinutes: dur,
    });
    if (dur < effectiveBlock) {
      out.rejectedIntervals.push({
        ...minToHhmmPair(seg),
        durationMinutes: dur,
        reason:
          dur <= 0 ? 'empty_interval_after_subtract' : 'too short for service',
      });
    }
  }

  const { startMs: dayStartUtcMs } = businessLocalDayBounds(timeZone, ymd);

  for (const seg of freeAfterBookings) {
    const segLen = seg.end - seg.start;
    if (segLen < effectiveBlock) continue;

    const theoreticalStarts = countStartsInSegments([seg], effectiveBlock, stepMinutes);
    const wins = generateSlotsFromInterval(seg, effectiveBlock, stepMinutes, ymd, dayStartUtcMs);

    if (theoreticalStarts === 0) {
      throw new DebugAvailabilityInvariantError(
        JSON.stringify({
          message:
            'Invariant: free interval fits effective block but grid produced zero aligned starts',
          interval: minToHhmmPair(seg),
          durationMinutes: segLen,
          serviceDurationMinutes: serviceDur,
          effectiveBlockMinutes: effectiveBlock,
          stepMinutes,
          timezone: timeZone,
          date: ymd,
        }),
      );
    }

    if (wins.length === 0) {
      throw new DebugAvailabilityInvariantError(
        JSON.stringify({
          message:
            'Invariant: free interval duration >= effectiveBlockMinutes but generateSlotsFromInterval returned no windows',
          interval: minToHhmmPair(seg),
          durationMinutes: segLen,
          effectiveBlockMinutes: effectiveBlock,
          stepMinutes,
          dayStartUtcMs,
          timezone: timeZone,
          date: ymd,
        }),
      );
    }

    for (const w of wins) {
      out.validSlots.push({
        start: formatBusinessTime(w.start, timeZone),
        end: formatBusinessTime(w.end, timeZone),
      });
    }
  }

  return out;
}

/** @deprecated Use {@link debugAvailabilityDay} */
export const runDebugAvailabilityDay = debugAvailabilityDay;

export type DebugAvailabilityDayParams = DebugAvailabilityDayInput;
export type DebugAvailabilityDayResult = DebugAvailabilityDayReport;
