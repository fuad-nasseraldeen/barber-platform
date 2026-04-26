/**
 * Single scheduling clock: all business-logic wall times use the business IANA zone.
 * DB remains UTC (Date / timestamptz). Convert only at boundaries via Luxon — never `Date#toISOString()` for math.
 * Application code should import from `./time` (central facade + “no native Date” policy).
 */
import { DateTime } from 'luxon';

export class TimeEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeEngineError';
  }
}

/** @throws TimeEngineError if zone is not a valid IANA identifier */
export function ensureValidBusinessZone(timeZone: string): string {
  const z = (timeZone ?? '').trim() || 'UTC';
  const probe = DateTime.now().setZone(z);
  if (!probe.isValid) {
    throw new TimeEngineError(`Invalid business IANA timezone: ${timeZone} (${probe.invalidReason ?? 'unknown'})`);
  }
  return z;
}

/** Current instant expressed in the business wall clock (Luxon). */
export function getBusinessNow(timeZone: string): DateTime {
  return DateTime.now().setZone(ensureValidBusinessZone(timeZone));
}

/**
 * Absolute UTC instant → same instant, shown in business zone.
 * `dateUtc` must be the real UTC instant (e.g. from Postgres).
 */
export function toBusinessTime(dateUtc: Date, timeZone: string): DateTime {
  return DateTime.fromJSDate(dateUtc, { zone: 'utc' }).setZone(ensureValidBusinessZone(timeZone));
}

/**
 * Business-local calendar day start (midnight in zone) as Luxon (zone-fixed).
 */
export function getStartOfDay(ymd: string, timeZone: string): DateTime {
  const z = ensureValidBusinessZone(timeZone);
  const d = DateTime.fromISO(ymd.slice(0, 10), { zone: z }).startOf('day');
  if (!d.isValid) {
    throw new TimeEngineError(`Invalid calendar date for zone ${z}: ${ymd} (${d.invalidReason ?? 'unknown'})`);
  }
  return d;
}

/** Business-local wall start on calendarYmd — single source for minutes-from-midnight + persistence. */
export type BusinessWallClockStart = {
  calendarYmd: string;
  businessTimeZone: string;
  wallHhmm: string;
  localDayStart: DateTime;
  localStart: DateTime;
  /** Minutes from business-local midnight on calendarYmd (same timeline as availability engine). */
  slotStartMin: number;
};

/** Business-local wall slot [start, end) on one calendar day. */
export type BusinessWallSlotLocal = BusinessWallClockStart & {
  slotEndMin: number;
  localEnd: DateTime;
};

/**
 * Parse wall HH:mm on a business calendar day. Derives `slotStartMin` only from Luxon local `DateTime`
 * (not a separate string → integer path) to avoid TZ / parser drift vs persistence.
 */
export function parseBusinessWallClockStart(input: {
  calendarYmd: string;
  wallHhmm: string;
  timeZone: string;
}): BusinessWallClockStart {
  const z = ensureValidBusinessZone(input.timeZone);
  const ymd = input.calendarYmd.slice(0, 10);
  const wall = input.wallHhmm.trim();
  const dayStart = getStartOfDay(ymd, z);
  const parts = wall.split(':');
  const hh = parseInt(parts[0] ?? '', 10);
  const mm = parseInt(parts[1] ?? '0', 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
    throw new TimeEngineError(`Invalid HH:mm: ${input.wallHhmm}`);
  }
  const localStart = dayStart.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
  if (!localStart.isValid) {
    throw new TimeEngineError(`Invalid wall time ${ymd} ${wall} in ${z}`);
  }
  const slotStartMin = Math.trunc(localStart.diff(dayStart, 'minutes').minutes);
  return {
    calendarYmd: ymd,
    businessTimeZone: z,
    wallHhmm: wall,
    localDayStart: dayStart,
    localStart,
    slotStartMin,
  };
}

/** Wall start + duration in the same business-local day → local end + end minutes. */
export function parseBusinessWallSlotLocal(input: {
  calendarYmd: string;
  wallHhmm: string;
  durationMinutes: number;
  timeZone: string;
}): BusinessWallSlotLocal {
  const start = parseBusinessWallClockStart({
    calendarYmd: input.calendarYmd,
    wallHhmm: input.wallHhmm,
    timeZone: input.timeZone,
  });
  const dur = Math.max(1, Math.floor(Math.trunc(input.durationMinutes)));
  const localEnd = start.localStart.plus({ minutes: dur });
  if (!localEnd.isValid) {
    throw new TimeEngineError('Invalid slot end (duration) in business zone');
  }
  return {
    ...start,
    slotEndMin: start.slotStartMin + dur,
    localEnd,
  };
}

/**
 * Wall time on a business-local day → UTC `Date` for persistence.
 * `hhmm` is `HH:mm` on that calendar date in `timeZone`.
 */
export function toUtcFromBusinessHhmm(ymd: string, hhmm: string, timeZone: string): Date {
  const { localStart } = parseBusinessWallClockStart({
    calendarYmd: ymd,
    wallHhmm: hhmm,
    timeZone,
  });
  return localStart.toUTC().toJSDate();
}

/** Minutes from local midnight on `ymd` → UTC Date. */
export function toUtcFromBusinessMinutes(ymd: string, minutesFromMidnight: number, timeZone: string): Date {
  const day = getStartOfDay(ymd, timeZone);
  const local = day.plus({ minutes: minutesFromMidnight });
  if (!local.isValid) {
    throw new TimeEngineError(`Invalid minutesFromMidnight ${minutesFromMidnight} on ${ymd}`);
  }
  return local.toUTC().toJSDate();
}

/** Format absolute UTC instant for display / logs in business zone (default full local timestamp). */
export function formatBusinessTime(dateUtc: Date, timeZone: string, format = 'yyyy-MM-dd HH:mm'): string {
  return toBusinessTime(dateUtc, timeZone).toFormat(format);
}

/** Today’s Y-M-D in the business zone (“now” for that business). */
export function getBusinessTodayYmd(timeZone: string): string {
  return getBusinessNow(timeZone).toISODate()!;
}

/** Whole days from business “today” to `dateYmd` (can be negative if date is past). */
export function diffBusinessLocalDaysFromToday(dateYmd: string, timeZone: string): number {
  const todayYmd = getBusinessTodayYmd(timeZone);
  const d0 = getStartOfDay(todayYmd, timeZone);
  const d1 = getStartOfDay(dateYmd, timeZone);
  return Math.round(d1.diff(d0, 'days').days);
}

/** Whether `dateYmd` is today … today+windowDays in business local time. */
export function isWithinBusinessBookingWindow(
  dateYmd: string,
  timeZone: string,
  windowDays: number,
): boolean {
  const d = diffBusinessLocalDaysFromToday(dateYmd.slice(0, 10), timeZone);
  return d >= 0 && d <= windowDays;
}
