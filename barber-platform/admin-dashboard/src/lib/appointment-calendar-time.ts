import { DateTime } from "luxon";

const DEBUG = process.env.NEXT_PUBLIC_APPOINTMENT_CALENDAR_DEBUG === "1";

/**
 * מחרוזת שעה מה-API (אחסון UTC):
 * - עם Z / אופסט → אותו רגע בזמן (Luxon `setZone: true`).
 * - בלי אזור → מתפרש כשעון UTC (למשל `2026-04-03T06:00:00` = 06:00 UTC).
 * לרינדור: `parseAppointmentApiInstant(iso).setZone(businessTimezone)` (מגיע מה-API, לא קשיח).
 */
export function parseAppointmentApiInstant(raw: string): DateTime {
  const t = raw.trim();
  if (!t) return DateTime.invalid("empty");
  const hasOffset =
    /Z$/i.test(t) || /[+-]\d{2}:\d{2}$/.test(t) || /[+-]\d{4}$/.test(t);
  if (hasOffset) {
    return DateTime.fromISO(t, { setZone: true });
  }
  const iso = t.length >= 19 ? t.slice(0, 19) : t;
  return DateTime.fromISO(iso, { zone: "utc" });
}

/**
 * FullCalendar / אירועים: `start`/`end` כ-ISO עם אופסט של אזור העסק (אותו רגע, תצוגה נכונה עם `timeZone`).
 */
export function apiAppointmentRangeForCalendar(
  startTime: string,
  endTime: string,
  businessZone: string,
): { start: string; end: string } {
  const start = parseAppointmentApiInstant(startTime).setZone(businessZone);
  const end = parseAppointmentApiInstant(endTime).setZone(businessZone);
  if (DEBUG && typeof console !== "undefined") {
    console.log({ raw: startTime, local: start.toISO() });
    console.log({ raw: endTime, local: end.toISO() });
  }
  const s = start.toISO();
  const e = end.toISO();
  if (!s || !e) {
    return { start: startTime, end: endTime };
  }
  return { start: s, end: e };
}
