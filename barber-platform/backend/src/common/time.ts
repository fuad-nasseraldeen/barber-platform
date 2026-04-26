/**
 * DO NOT USE native Date or Date.now() for business logic, “current time”, or timezone math.
 * Use Luxon DateTime with an explicit IANA zone. DB stores UTC instants; convert at boundaries only.
 *
 * Persistence / Prisma often requires `Date`: use `utcNowJsDate()` or `DateTime#toJSDate()` at those edges only.
 */
import { DateTime } from 'luxon';
import {
  ensureValidBusinessZone,
  getBusinessNow as getBusinessNowCore,
  getStartOfDay,
  toBusinessTime as toBusinessTimeCore,
  toUtcFromBusinessHhmm,
  TimeEngineError,
} from './time-engine';
import { parseApiIso } from './parse-api-iso';

export {
  ensureValidBusinessZone,
  TimeEngineError,
  formatBusinessTime,
  getBusinessTodayYmd,
  parseBusinessWallClockStart,
  parseBusinessWallSlotLocal,
  type BusinessWallClockStart,
  type BusinessWallSlotLocal,
} from './time-engine';

export function getBusinessNow(timezone: string): DateTime {
  return getBusinessNowCore(timezone);
}

/**
 * Business calendar date + wall time (HH:mm on that date in `timezone`) → UTC instant for DB.
 */
export function toUtcFromBusiness(date: string, time: string, timezone: string): Date {
  const ymd = date.slice(0, 10);
  const raw = time.trim();
  const hhmm = raw.includes(':') ? raw.slice(0, 5) : `${raw.padStart(2, '0')}:00`;
  return toUtcFromBusinessHhmm(ymd, hhmm, timezone);
}

/** UTC instant from DB → zoned DateTime in business wall clock (same instant, different view). */
export function toBusinessTime(dateUtc: Date, timezone: string): DateTime {
  return toBusinessTimeCore(dateUtc, timezone);
}

/** Start of business-local calendar day (midnight in zone). */
export function startOfBusinessDay(date: string, timezone: string): DateTime {
  return getStartOfDay(date, timezone);
}

/** `now` as ISO-8601 in the business zone (offset included), for API clients. */
export function businessNowIsoInZone(timezone: string): string {
  const z = ensureValidBusinessZone(timezone);
  const dt = DateTime.now().setZone(z);
  return dt.toISO({ includeOffset: true }) ?? dt.toString();
}

/** Current instant as UTC `Date` (SQL / Prisma). Prefer not to do arithmetic on this type. */
export function utcNowJsDate(): Date {
  return DateTime.utc().toJSDate();
}

/** Monotonic-ish wall clock for metrics; prefer over `Date.now()`. */
export function wallClockMs(): number {
  return DateTime.now().toMillis();
}

/** DST-safe UTC instant from DB + duration. */
export function addUtcMinutes(fromUtc: Date, minutes: number): Date {
  return DateTime.fromJSDate(fromUtc, { zone: 'utc' }).plus({ minutes }).toJSDate();
}

/** Parse API ISO datetime (may include offset or Z) → UTC instant for Prisma. */
export function parseIsoToUtcJsDate(iso: string): Date {
  const dt = parseApiIso(iso);
  if (!dt.isValid) {
    throw new TimeEngineError(`Invalid ISO instant: ${iso} (${dt.invalidReason})`);
  }
  return dt.toUTC().toJSDate();
}
