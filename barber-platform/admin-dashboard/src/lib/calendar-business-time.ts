import { DateTime } from "luxon";
import { parseAppointmentApiInstant } from "./appointment-calendar-time";
import { resolveBusinessTimeZone } from "./time-engine";

export { parseApiDate } from "./parse-api-date";

/** API instant → same instant, wall clock in business IANA zone (single conversion). */
export function apiIsoToBusinessWall(iso: string, businessZone: string): DateTime {
  return parseAppointmentApiInstant(iso).setZone(businessZone);
}

/** @deprecated Use `resolveBusinessTimeZone` from `@/lib/time-engine` (same behavior). */
export function resolveScheduleTimeZone(storedTimezone: string | null | undefined): string {
  return resolveBusinessTimeZone(storedTimezone);
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (![h, m].every((n) => Number.isFinite(n))) return 0;
  return h * 60 + m;
}

/** JS getDay(): 0=Sunday .. 6=Saturday for a Y-M-D interpreted in `zone`. */
export function jsDayOfWeekInZone(ymd: string, zone: string): number {
  const d = DateTime.fromISO(ymd, { zone });
  if (!d.isValid) return 0;
  const luxonWd = d.weekday;
  return luxonWd % 7;
}

/** @deprecated Use `parseAppointmentApiInstant` — kept for call sites that only need the instant. */
export function instantFromApiIso(iso: string): DateTime {
  return parseAppointmentApiInstant(iso);
}

export function businessLocalYmdFromIso(iso: string, zone: string): string {
  const t = apiIsoToBusinessWall(iso, zone);
  return t.toISODate() ?? iso.slice(0, 10);
}

export function minutesFromMidnightInZone(iso: string, zone: string): number {
  const t = apiIsoToBusinessWall(iso, zone);
  return t.hour * 60 + t.minute + t.second / 60;
}

export function dayStartInZone(ymd: string, zone: string): DateTime {
  return DateTime.fromISO(ymd, { zone }).startOf("day");
}

/** Wall-clock minutes from local midnight on `ymd` in `zone` → UTC ISO for API. */
export function wallTimeToUtcIso(ymd: string, zone: string, minutesFromMidnight: number): string {
  const day = dayStartInZone(ymd, zone);
  const t = day.plus({ minutes: minutesFromMidnight });
  return t.toUTC().toISO() ?? t.toISO()!;
}

export function snapToStep(minutes: number, step: number): number {
  return Math.round(minutes / step) * step;
}

export function formatHhMmInZone(iso: string, zone: string): string {
  return apiIsoToBusinessWall(iso, zone).toFormat("HH:mm");
}
