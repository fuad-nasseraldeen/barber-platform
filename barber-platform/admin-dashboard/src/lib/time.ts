/**
 * DO NOT USE native Date for business-visible clocks. Use Luxon with explicit IANA zone.
 */
import { DateTime } from "luxon";
import { parseApiDate } from "./parse-api-date";

/** Parse API “now” (ISO with Z or offset) as DateTime; falls back to live clock in zone. */
export function getBusinessNow(
  businessNowIso: string | undefined,
  timezone: string,
): DateTime {
  if (businessNowIso) {
    const parsed = parseApiDate(businessNowIso);
    if (parsed.isValid) return parsed;
  }
  return DateTime.now().setZone(timezone);
}

/** API instant (Z or offset) → wall clock in `timezone`. */
export function utcInstantToZoned(isoUtc: string, timezone: string): DateTime {
  return parseApiDate(isoUtc).setZone(timezone);
}

export function wallClockMs(): number {
  return DateTime.now().toMillis();
}
