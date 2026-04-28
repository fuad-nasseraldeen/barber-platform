import { DateTime } from "luxon";

/** When set to "1", logs each parse (raw string, resolved zone name, offset minutes). */
const PARSE_DEBUG = process.env.NEXT_PUBLIC_PARSE_API_TIME_DEBUG === "1";

/**
 * Parse an API datetime string into a correct instant (no double shifting).
 * `setZone: true` keeps the offset embedded in the string (Z, +03:00, +00:00) — one semantic parse.
 * Avoid `{ zone: "utc" }` together with `Z`; in some paths it produced wall-clock skew vs `toISO()` from the server.
 */
export function parseApiDate(raw: string): DateTime {
  const trimmed = raw.trim();
  const dt = DateTime.fromISO(trimmed, { setZone: true });

  if (PARSE_DEBUG && typeof console !== "undefined") {
    console.log({
      raw: trimmed,
      zone: dt.zoneName,
      offset: dt.offset,
      valid: dt.isValid,
    });
  }

  return dt;
}
