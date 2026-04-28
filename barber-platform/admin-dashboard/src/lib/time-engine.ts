/**
 * Client scheduling clock: align UI with backend by using the **business** IANA timezone only.
 * Do not mix `Date` local semantics with business wall time for availability or calendar days.
 */
import { DateTime } from "luxon";

/** Business record timezone, else UTC (explicit; no browser-time guess). */
export function resolveBusinessTimeZone(stored: string | null | undefined): string {
  const z = (stored ?? "").trim();
  if (z && DateTime.now().setZone(z).isValid) return z;
  return "UTC";
}

export function ensureValidBusinessZone(timezone: string): string {
  return resolveBusinessTimeZone(timezone || null);
}

export function getBusinessNow(timezone: string): DateTime {
  return DateTime.now().setZone(ensureValidBusinessZone(timezone));
}

export function toBusinessTime(dateUtc: Date, timezone: string): DateTime {
  return DateTime.fromJSDate(dateUtc, { zone: "utc" }).setZone(ensureValidBusinessZone(timezone));
}

export function formatBusinessTime(
  dateUtc: Date,
  timezone: string,
  format = "yyyy-MM-dd HH:mm",
): string {
  return toBusinessTime(dateUtc, timezone).toFormat(format);
}

export function getStartOfBusinessDay(ymd: string, timezone: string): DateTime {
  return DateTime.fromISO(ymd.slice(0, 10), {
    zone: ensureValidBusinessZone(timezone),
  }).startOf("day");
}

/** Interpret browser “picked day” as noon on that local civil date, then re-anchor in business zone (navigation only). */
export function jsDateToBusinessYmd(d: Date, timezone: string): string {
  const civil = DateTime.fromJSDate(d);
  const y = civil.year;
  const m = civil.month;
  const day = civil.day;
  return DateTime.fromObject({ year: y, month: m, day }, { zone: ensureValidBusinessZone(timezone) }).toISODate()!;
}
