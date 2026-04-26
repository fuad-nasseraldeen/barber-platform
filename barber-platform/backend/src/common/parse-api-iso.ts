import { DateTime } from 'luxon';

const DEBUG = process.env.PARSE_API_TIME_DEBUG === '1';

/**
 * Parse client/API ISO datetime: Z suffix uses explicit UTC; otherwise trust embedded offset / Luxon.
 * Use before converting to UTC Date for Prisma (do not force utc zone on offset strings).
 */
export function parseApiIso(raw: string): DateTime {
  const trimmed = raw.trim();
  const dt = DateTime.fromISO(trimmed, { setZone: true });
  if (DEBUG) {
    console.log({
      raw: trimmed,
      zone: dt.zoneName,
      offset: dt.offset,
      valid: dt.isValid,
    });
  }
  return dt;
}
