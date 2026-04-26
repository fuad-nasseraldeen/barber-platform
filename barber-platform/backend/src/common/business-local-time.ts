import { DateTime } from 'luxon';

/**
 * Business-time helpers for availability: `YYYY-MM-DD` from the API is the calendar date in the
 * business IANA zone (e.g. Asia/Jerusalem), not “UTC date”.
 */

/** Prisma staff working hours: 0 = Sunday … 6 = Saturday (same as JS Date#getDay()). */
export function businessLocalDayOfWeek(timeZone: string, ymd: string): number {
  const dt = DateTime.fromISO(ymd, { zone: timeZone });
  if (!dt.isValid) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  }
  return dt.weekday % 7;
}

/** Half-open [startMs, endMs) UTC instants spanning that local calendar day. */
export function businessLocalDayBounds(
  timeZone: string,
  ymd: string,
): { startMs: number; endMs: number } {
  const start = DateTime.fromISO(ymd, { zone: timeZone }).startOf('day');
  if (!start.isValid) {
    const [y, m, d] = ymd.split('-').map(Number);
    const u = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
    return { startMs: u, endMs: u + 86400000 };
  }
  const startMs = start.toMillis();
  const endMs = start.plus({ days: 1 }).startOf('day').toMillis();
  return { startMs, endMs };
}

export function resolveBusinessTimeZone(raw: string | null | undefined): string {
  const z = (raw ?? 'UTC').trim() || 'UTC';
  if (!DateTime.now().setZone(z).isValid) {
    return 'UTC';
  }
  return z;
}

/**
 * Wall clock for scheduling when the DB has UTC/empty (matches admin-dashboard
 * `useResolvedScheduleTimeZone`: bare UTC treated as unset → default IANA for Israel).
 * Prevents "picked 09:00, stored 09:00Z, calendar shows 12:00" when UI uses Asia/Jerusalem.
 */
export function resolveScheduleWallClockZone(raw: string | null | undefined): string {
  const z = (raw ?? '').trim();
  if (z && z.toUpperCase() !== 'UTC' && DateTime.now().setZone(z).isValid) {
    return z;
  }
  const fallback = 'Asia/Jerusalem';
  if (DateTime.now().setZone(fallback).isValid) {
    return fallback;
  }
  return 'UTC';
}

/** Add calendar days in the business zone (handles DST; not “+24h UTC”). */
export function addBusinessDaysFromYmd(
  timeZone: string,
  anchorYmd: string,
  deltaDays: number,
): string {
  let dt = DateTime.fromISO(anchorYmd, { zone: timeZone });
  if (!dt.isValid) {
    const [y, m, d] = anchorYmd.split('-').map(Number);
    dt = DateTime.fromObject({ year: y, month: m, day: d }, { zone: 'UTC' });
  }
  return dt.plus({ days: deltaDays }).toISODate()!;
}

/** Interpret a JS Date (e.g. Postgres DATE @ midnight UTC) as calendar Y-M-D in the business zone. */
export function businessLocalYmdFromJsDate(timeZone: string, d: Date): string {
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(timeZone).toISODate()!;
}

/** Format absolute instant as HH:mm in the business wall clock. */
export function formatInstantLocalHhmm(instant: Date, timeZone: string): string {
  return DateTime.fromJSDate(instant, { zone: timeZone }).toFormat('HH:mm');
}

export type HolidayCheckRow = { date: Date; isRecurring: boolean };

/** True if `dateStr` (business-local Y-M-D) is blocked by a business holiday. */
export function isCalendarDayHolidayInZone(
  dateStr: string,
  holidays: HolidayCheckRow[],
  timeZone: string,
): boolean {
  const ymd = dateStr.slice(0, 10);
  const local = DateTime.fromISO(ymd, { zone: timeZone });
  if (!local.isValid) return false;
  const { startMs, endMs } = businessLocalDayBounds(timeZone, ymd);
  const mo = local.month;
  const da = local.day;

  for (const h of holidays) {
    if (!h.isRecurring) {
      const t = h.date.getTime();
      if (t >= startMs && t < endMs) return true;
      if (businessLocalYmdFromJsDate(timeZone, h.date) === ymd) return true;
    } else {
      const anchor = DateTime.fromJSDate(h.date, { zone: 'utc' }).setZone(timeZone);
      if (anchor.month === mo && anchor.day === da) return true;
    }
  }
  return false;
}

/**
 * Business-local calendar date (YYYY-MM-DD) for an absolute instant, using wall clock in `timeZone`.
 */
export function utcToBusinessLocalYmd(utc: Date, timeZone: string): string {
  return DateTime.fromJSDate(utc, { zone: 'utc' }).setZone(timeZone).toISODate()!.slice(0, 10);
}

/**
 * Integer minutes from `calendarYmd` local midnight to this instant’s local wall clock.
 * When the instant falls on that calendar day in `timeZone`, uses hour/minute only (stable integers;
 * avoids `Duration#minutes` float noise like 539.999 → floor → false OUTSIDE_WORKING for 09:00).
 */
export function utcToBusinessLocalMinutesSinceDayStart(
  utc: Date,
  timeZone: string,
  calendarYmd: string,
): number {
  const ymd = calendarYmd.slice(0, 10);
  const dt = DateTime.fromJSDate(utc, { zone: 'utc' }).setZone(timeZone);
  const dayStart = DateTime.fromISO(ymd, { zone: timeZone }).startOf('day');
  if (!dt.isValid || !dayStart.isValid) return Number.NaN;
  if (dt.toISODate() === ymd) {
    return Math.trunc(dt.hour) * 60 + Math.trunc(dt.minute);
  }
  return Math.round((dt.toMillis() - dayStart.toMillis()) / 60_000);
}

/**
 * "09:00" / "09:00:00" wall clock → integer minutes from midnight (business-local semantic; parse only).
 */
export function wallHhmmStringToMinuteOfDay(hhmm: string): number {
  const parts = hhmm.trim().split(':').map((p) => parseInt(p, 10));
  const h = Number.isFinite(parts[0]) ? parts[0] : 0;
  const m = Number.isFinite(parts[1]) ? parts[1] : 0;
  return h * 60 + m;
}

/** True when wall strings form a positive-length same-day window. */
export function isValidWorkingHoursWindow(startTime: string, endTime: string): boolean {
  const s = wallHhmmStringToMinuteOfDay(startTime);
  const e = wallHhmmStringToMinuteOfDay(endTime);
  return s < e;
}

export type StaffWeeklyWorkingHoursLike = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

export type StaffWorkingHoursDateOverrideLike = {
  date: Date;
  isClosed: boolean;
  startTime: string | null;
  endTime: string | null;
};

/**
 * Resolve bookable wall-clock window for a business-local calendar day.
 * Priority: date-specific override → weekly recurring hours → none (caller returns empty availability).
 */
export function resolveStaffWorkingHoursForBusinessLocalDay(input: {
  ymd: string;
  timeZone: string;
  weeklyRows: StaffWeeklyWorkingHoursLike[];
  dateOverrides: StaffWorkingHoursDateOverrideLike[];
}): { startTime: string; endTime: string } | null {
  const ymd = input.ymd.slice(0, 10);
  const ov = input.dateOverrides.find(
    (o) => businessLocalYmdFromJsDate(input.timeZone, o.date) === ymd,
  );
  if (ov) {
    if (ov.isClosed) return null;
    const st = ov.startTime?.trim() ?? '';
    const et = ov.endTime?.trim() ?? '';
    if (st && et && isValidWorkingHoursWindow(st, et)) {
      return { startTime: st, endTime: et };
    }
  }

  const dow = businessLocalDayOfWeek(input.timeZone, ymd);
  const wh = input.weeklyRows.find((w) => w.dayOfWeek === dow);
  if (!wh) return null;
  if (!isValidWorkingHoursWindow(wh.startTime, wh.endTime)) return null;
  return { startTime: wh.startTime, endTime: wh.endTime };
}

/** Alias: same numeric parse as {@link wallHhmmStringToMinuteOfDay} for `hhmmToMinutes`-style naming. */
export function hhmmWallClockToMinutes(hhmm: string): number {
  return wallHhmmStringToMinuteOfDay(hhmm);
}

/**
 * Numeric-only: wall block [slotStartMin, slotEndMin] must satisfy
 * slotStartMin ≥ workingStartMin and slotEndMin ≤ workingEndMin (end may equal WH close, e.g. 1080).
 */
export function isBookableBlockWithinWorkingWindow(
  slotStartMin: number,
  slotEndMin: number,
  workingStartMin: number,
  workingEndMin: number,
): boolean {
  const s = Math.trunc(slotStartMin);
  const e = Math.trunc(slotEndMin);
  const ws = Math.trunc(workingStartMin);
  const we = Math.trunc(workingEndMin);
  if (e < s) return false;
  return s >= ws && e <= we;
}

/** True iff [slotStartMin, slotEndMin) fits entirely inside at least one free half-open segment. */
export function isSlotBlockInsideFreeSegments(
  slotStartMin: number,
  slotEndMin: number,
  segments: Array<{ start: number; end: number }>,
): boolean {
  const s = Math.trunc(slotStartMin);
  const e = Math.trunc(slotEndMin);
  if (e < s) return false;
  for (const raw of segments) {
    const a = Math.trunc(raw.start);
    const b = Math.trunc(raw.end);
    if (b <= a) continue;
    if (s >= a && e <= b) return true;
  }
  return false;
}

/** Duration-based check: slotEnd = slotStart + duration (integer minutes). */
export function isSlotBlockWithinWorkingMinutes(
  slotStartMin: number,
  durationMin: number,
  workingStartMin: number,
  workingEndMin: number,
): boolean {
  const s = Math.trunc(slotStartMin);
  const dur = Math.max(1, Math.floor(Math.trunc(durationMin)));
  const slotEndMin = s + dur;
  return isBookableBlockWithinWorkingWindow(s, slotEndMin, workingStartMin, workingEndMin);
}

/**
 * DST-safe: interpret HH:mm on `calendarYmd` in `timeZone` and return the absolute UTC instant.
 */
export function businessLocalYmdHhmmToUtcDate(timeZone: string, calendarYmd: string, hhmm: string): Date {
  const ymd = calendarYmd.slice(0, 10);
  const mins = wallHhmmStringToMinuteOfDay(hhmm);
  const h = Math.floor(mins / 60);
  const mi = mins % 60;
  return DateTime.fromISO(ymd, { zone: timeZone })
    .set({ hour: h, minute: mi, second: 0, millisecond: 0 })
    .toUTC()
    .toJSDate();
}
