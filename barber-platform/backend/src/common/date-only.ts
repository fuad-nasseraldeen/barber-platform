/**
 * Calendar YYYY-MM-DD for Postgres @db.Date — avoids local-midnight shifts from
 * `new Date('YYYY-MM-DD'); d.setHours(0,0,0,0)` (e.g. Israel → previous UTC day).
 */
export function parseDateOnlyUtc(isoDate: string): Date {
  const d = isoDate.slice(0, 10);
  return new Date(`${d}T00:00:00.000Z`);
}

/** End of that calendar day in UTC (inclusive upper bound for DATE filters). */
export function endDateOnlyUtcInclusive(isoDate: string): Date {
  const d = isoDate.slice(0, 10);
  return new Date(`${d}T23:59:59.999Z`);
}

/**
 * Start instant for POST /book — must match `buildCandidateStartsUtc` (UTC wall clock on calendar day).
 * Do not use `new Date(\`${date}T${hh}:00\`)` (that parses as server-local timezone).
 */
export function parseBookingStartUtc(dateYmd: string, startTimeHhMm: string): Date {
  const d = dateYmd.slice(0, 10);
  const [y, mo, day] = d.split('-').map(Number);
  const [hh, mm] = startTimeHhMm.split(':').map(Number);
  if (
    ![y, mo, day, hh, mm].every((n) => Number.isFinite(n)) ||
    mo < 1 ||
    mo > 12 ||
    day < 1 ||
    day > 31
  ) {
    return new Date(Number.NaN);
  }
  return new Date(Date.UTC(y, mo - 1, day, hh, mm, 0, 0));
}

/** Next calendar day in UTC from YYYY-MM-DD. */
export function addUtcDaysToYmd(dateYmd: string, deltaDays: number): string {
  const d = dateYmd.slice(0, 10);
  const [y, mo, day] = d.split('-').map(Number);
  const ms = Date.UTC(y, mo - 1, day) + deltaDays * 86400000;
  const x = new Date(ms);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}
