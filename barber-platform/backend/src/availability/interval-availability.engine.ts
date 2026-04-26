/**
 * Interval-first availability: real free windows on the UTC calendar day, then every valid
 * start time spaced by `stepMinutes` (default 5). No global 30-minute booking grid, no greedy packing.
 *
 * Bookable window for each offer is [start, end) with end - start = serviceDurationMinutes.
 */

import { DateTime } from 'luxon';
import { parseDateOnlyUtc } from '../common/date-only';
import { businessLocalDayBounds } from '../common/business-local-time';
import { ensureValidBusinessZone, TimeEngineError } from '../common/time-engine';
import { subtractRanges, type TimeRangeMin } from './simple-availability.engine';

/** Half-open interval in minutes from business-local midnight on dateStr [start, end). */
export type MinuteInterval = TimeRangeMin;

/**
 * Integer-truncate interval bounds (defensive against float leakage from ms/60_000).
 */
export function normalizeMinuteInterval(free: MinuteInterval): MinuteInterval {
  return {
    start: Math.trunc(free.start),
    end: Math.trunc(free.end),
  };
}

/**
 * True iff the bookable block [slotStartMin, slotStartMin + blockDurationMin) lies fully inside
 * the half-open free interval [free.start, free.end).
 *
 * Both bounds are integer minutes. Exact end-touch is allowed: slotStart + duration === free.end.
 */
export function slotBlockFitsFreeInterval(
  slotStartMin: number,
  blockDurationMin: number,
  free: MinuteInterval,
): boolean {
  const dur = Math.max(1, Math.floor(Math.trunc(blockDurationMin)));
  const t = Math.trunc(slotStartMin);
  const seg = normalizeMinuteInterval(free);
  if (seg.end <= seg.start) return false;
  const slotEnd = t + dur;
  return t >= seg.start && slotEnd <= seg.end;
}

/** Same “fits” predicate as generation: use identical duration normalization as {@link generateSlotStartsFromFreeIntervals}. */
export function slotBlockFitsAnyFreeSegment(
  slotStartMin: number,
  serviceDurationMinutes: number,
  segments: MinuteInterval[],
): boolean {
  if (segments.length === 0) return false;
  const dur = Math.max(1, Math.floor(Math.trunc(serviceDurationMinutes)));
  const t = Math.trunc(slotStartMin);
  return segments.some((seg) => slotBlockFitsFreeInterval(t, dur, seg));
}

/**
 * Bookable start minutes inside one free segment [start, end). Stride begins at `free.start` by `stepMinutes`.
 * Emits `t` only if `t + blockDurationMin <= free.end` (end-touch allowed). Matches production slot listing.
 */
export function eachGridAlignedSlotStartInFreeInterval(
  free: MinuteInterval,
  blockDurationMin: number,
  stepMinutes: number,
): number[] {
  const seg = normalizeMinuteInterval(free);
  const dur = Math.max(1, Math.floor(Math.trunc(blockDurationMin)));
  const step = Math.max(1, Math.floor(Math.trunc(stepMinutes)));
  const segStart = seg.start;
  const segEnd = seg.end;
  if (segEnd <= segStart || segStart + dur > segEnd) return [];

  const out: number[] = [];
  for (let t = segStart; ; t += step) {
    const slotEnd = t + dur;
    if (slotEnd > segEnd) break;
    out.push(t);
  }
  return out;
}

export type UtcBookableWindow = {
  start: Date;
  end: Date;
};

export type ComputeAvailabilityInput = {
  /** YYYY-MM-DD — calendar date in the business IANA timezone. */
  dateStr: string;
  /** Working window: minutes from local midnight on dateStr. */
  workingWindow: MinuteInterval;
  /** Breaks / exceptions in the same local-minute timeline. */
  breaksAndExceptions: MinuteInterval[];
  /**
   * Appointments clipped to this local calendar day as minute intervals [start, end).
   * May overlap; will be merged before subtraction.
   */
  busyFromBookings: MinuteInterval[];
  /** Wall-clock length of the bookable appointment (service + buffers, integer minutes). */
  serviceDurationMinutes: number;
  /** Advance between offered start times (minutes). Default 5 in the service layer. */
  stepMinutes: number;
  /**
   * UTC millis at business-local midnight for dateStr. When omitted, legacy anchor = UTC midnight.
   */
  dayStartUtcMs?: number;
  /**
   * When set with `dayStartUtcMs`, must equal `businessLocalDayBounds(this, dateStr).startMs`
   * or we throw — catches mixed UTC vs business-local day anchors.
   */
  businessTimeZone?: string;
};

/**
 * Subtract many busy intervals from many free intervals.
 * Busy list is sorted and each free segment is carved with the same subtractRanges logic (O(B) per segment).
 * Total O(F * B); F and B are tiny in practice (<20).
 */
export function subtractIntervals(
  freeSegments: MinuteInterval[],
  busyIntervals: MinuteInterval[],
): MinuteInterval[] {
  if (freeSegments.length === 0) return [];
  if (busyIntervals.length === 0) return freeSegments.map((s) => ({ ...s }));
  const sortedBusy = mergeMinuteIntervals(busyIntervals);
  const out: MinuteInterval[] = [];
  for (const f of freeSegments) {
    out.push(...subtractRanges(f, sortedBusy));
  }
  return out.filter((s) => s.end > s.start);
}

/**
 * Merge overlapping / touching busy intervals so subtraction stays linear and correct.
 * Touching [a,b) and [b,c) merge into [a,c).
 */
export function mergeMinuteIntervals(intervals: MinuteInterval[]): MinuteInterval[] {
  if (intervals.length === 0) return [];
  const s = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: MinuteInterval[] = [{ start: s[0].start, end: s[0].end }];
  for (let i = 1; i < s.length; i++) {
    const cur = s[i];
    const last = out[out.length - 1];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

/**
 * Every start time `t` in `free` with step `stepMinutes`, aligned to the step grid, such that
 * [t, t + serviceDuration) ⊆ [free.start, free.end).
 */
export function generateSlotsFromInterval(
  free: MinuteInterval,
  serviceDurationMinutes: number,
  stepMinutes: number,
  dateStr: string,
  dayStartUtcMs?: number,
): UtcBookableWindow[] {
  const dur = Math.max(1, Math.floor(serviceDurationMinutes));
  const step = Math.max(1, Math.floor(stepMinutes));
  const seg = normalizeMinuteInterval(free);
  if (seg.end <= seg.start || seg.start + dur > seg.end) return [];

  const [y, mo, d] = dateStr.slice(0, 10).split('-').map(Number);
  const baseMs =
    dayStartUtcMs !== undefined
      ? dayStartUtcMs
      : Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
  const out: UtcBookableWindow[] = [];

  const starts = eachGridAlignedSlotStartInFreeInterval(seg, dur, step);
  for (const t of starts) {
    const startMs = baseMs + t * 60_000;
    const endMs = startMs + dur * 60_000;
    out.push({
      start: DateTime.fromMillis(startMs, { zone: 'utc' }).toJSDate(),
      end: DateTime.fromMillis(endMs, { zone: 'utc' }).toJSDate(),
    });
  }
  return out;
}

/** Count valid starts in segments (for metrics / entropy without building Date objects). */
export function countStartsInSegments(
  segments: MinuteInterval[],
  serviceDurationMinutes: number,
  stepMinutes: number,
): number {
  const dur = Math.max(1, Math.floor(serviceDurationMinutes));
  const step = Math.max(1, Math.floor(stepMinutes));
  let n = 0;
  for (const segRaw of segments) {
    const seg = normalizeMinuteInterval(segRaw);
    n += eachGridAlignedSlotStartInFreeInterval(seg, dur, step).length;
  }
  return n;
}

/**
 * Full pipeline: working − breaks − bookings → free windows → all valid [start,end) offers.
 */
export function computeAvailability(input: ComputeAvailabilityInput): UtcBookableWindow[] {
  const {
    dateStr,
    workingWindow,
    breaksAndExceptions,
    busyFromBookings,
    serviceDurationMinutes,
    stepMinutes,
    dayStartUtcMs,
    businessTimeZone,
  } = input;

  if (businessTimeZone != null && dayStartUtcMs !== undefined) {
    const z = ensureValidBusinessZone(businessTimeZone);
    const { startMs } = businessLocalDayBounds(z, dateStr.slice(0, 10));
    if (startMs !== dayStartUtcMs) {
      throw new TimeEngineError(
        `Availability timeline mismatch for ${dateStr} in ${z}: dayStartUtcMs=${dayStartUtcMs} expected ${startMs} (business-local midnight)`,
      );
    }
  }

  if (
    workingWindow.end <= workingWindow.start ||
    !Number.isFinite(serviceDurationMinutes) ||
    serviceDurationMinutes < 1
  ) {
    return [];
  }

  const afterBreaks = subtractRanges(workingWindow, mergeMinuteIntervals(breaksAndExceptions));
  const freeAfterBookings = subtractIntervals(afterBreaks, busyFromBookings);

  const windows: UtcBookableWindow[] = [];
  for (const seg of freeAfterBookings) {
    windows.push(
      ...generateSlotsFromInterval(
        seg,
        serviceDurationMinutes,
        stepMinutes,
        dateStr,
        dayStartUtcMs,
      ),
    );
  }

  windows.sort((a, b) => a.start.getTime() - b.start.getTime());
  return windows;
}

/**
 * Same valid starts as {@link computeAvailability}, but as minute offsets from local midnight
 * (no per-slot `Date` allocations — faster for Layer-2 slot listing).
 */
export function computeAvailabilityStartMinutes(
  input: ComputeAvailabilityInput,
): number[] {
  const {
    dateStr,
    workingWindow,
    breaksAndExceptions,
    busyFromBookings,
    serviceDurationMinutes,
    stepMinutes,
    dayStartUtcMs,
    businessTimeZone,
  } = input;

  if (businessTimeZone != null && dayStartUtcMs !== undefined) {
    const z = ensureValidBusinessZone(businessTimeZone);
    const { startMs } = businessLocalDayBounds(z, dateStr.slice(0, 10));
    if (startMs !== dayStartUtcMs) {
      throw new TimeEngineError(
        `Availability timeline mismatch for ${dateStr} in ${z}: dayStartUtcMs=${dayStartUtcMs} expected ${startMs} (business-local midnight)`,
      );
    }
  }

  if (
    workingWindow.end <= workingWindow.start ||
    !Number.isFinite(serviceDurationMinutes) ||
    serviceDurationMinutes < 1
  ) {
    return [];
  }

  const afterBreaks = subtractRanges(workingWindow, mergeMinuteIntervals(breaksAndExceptions));
  const freeAfterBookings = subtractIntervals(afterBreaks, busyFromBookings);

  const dur = Math.max(1, Math.floor(serviceDurationMinutes));
  const step = Math.max(1, Math.floor(stepMinutes));
  const out: number[] = [];
  for (const segRaw of freeAfterBookings) {
    const seg = normalizeMinuteInterval(segRaw);
    out.push(...eachGridAlignedSlotStartInFreeInterval(seg, dur, step));
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Convert appointments intersecting the UTC calendar day into minute intervals [start,end)
 * relative to that day's midnight UTC.
 */
export function appointmentsToMinuteIntervalsOnUtcDay(
  appointments: Array<{ startTime: Date; endTime: Date }>,
  dateStr: string,
): MinuteInterval[] {
  const dayStart = parseDateOnlyUtc(dateStr.slice(0, 10));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const t0 = dayStart.getTime();
  const t1 = dayEnd.getTime();
  const out: MinuteInterval[] = [];

  for (const a of appointments) {
    if (!a.startTime || !a.endTime) continue;
    const s = Math.max(a.startTime.getTime(), t0);
    const e = Math.min(a.endTime.getTime(), t1);
    if (s >= e) continue;
    const startMin = (s - t0) / 60_000;
    const endMin = (e - t0) / 60_000;
    out.push({
      start: Math.max(0, Math.floor(startMin)),
      end: Math.min(24 * 60, Math.ceil(endMin)),
    });
  }
  return mergeMinuteIntervals(out);
}

/** Same `{ startTime, endTime }` shape as appointments; combine with bookings in {@link appointmentsToMinuteIntervalsOnBusinessLocalDay} (overlaps merged). */
export function slotHoldToBusyInterval(hold: { startTime: Date; endTime: Date }): {
  startTime: Date;
  endTime: Date;
} {
  return { startTime: hold.startTime, endTime: hold.endTime };
}

/**
 * Clip bookings to the business-local calendar day, express as minutes from that local midnight.
 */
export function appointmentsToMinuteIntervalsOnBusinessLocalDay(
  appointments: Array<{ startTime: Date; endTime: Date }>,
  dateStr: string,
  timeZone: string,
): MinuteInterval[] {
  const { startMs: t0, endMs: t1 } = businessLocalDayBounds(timeZone, dateStr.slice(0, 10));
  const out: MinuteInterval[] = [];

  for (const a of appointments) {
    if (!a.startTime || !a.endTime) continue;
    const bookingRawStart = a.startTime.getTime();
    const bookingRawEnd = a.endTime.getTime();
    const s = Math.max(bookingRawStart, t0);
    const e = Math.min(bookingRawEnd, t1);
    if (s >= e) continue;
    const startMin = (s - t0) / 60_000;
    const endMin = (e - t0) / 60_000;
    const startFloored = Math.max(0, Math.floor(startMin));
    const endCeiled = Math.min(24 * 60, Math.ceil(endMin));
    const bookingParsedStart = t0 + startFloored * 60_000;
    const bookingParsedEnd = t0 + endCeiled * 60_000;
    if (process.env.LOG_AVAILABILITY_BOOKING_PARSE_DIFF === '1') {
      loggerBookingParseDiff({
        dateStr: dateStr.slice(0, 10),
        timeZone,
        bookingRaw: { start: bookingRawStart, end: bookingRawEnd },
        bookingParsed: { start: bookingParsedStart, end: bookingParsedEnd },
      });
    }
    out.push({
      start: startFloored,
      end: endCeiled,
    });
  }
  return mergeMinuteIntervals(out);
}

/** Logs ms diff between DB instants and minute-grid instants used for subtraction (business-local day). */
function loggerBookingParseDiff(payload: {
  dateStr: string;
  timeZone: string;
  bookingRaw: { start: number; end: number };
  bookingParsed: { start: number; end: number };
}): void {
  const { bookingRaw, bookingParsed } = payload;
  console.log(
    '[booking-parse-diff]',
    JSON.stringify({
      ...payload,
      diff: {
        start: bookingParsed.start - bookingRaw.start,
        end: bookingParsed.end - bookingRaw.end,
      },
    }),
  );
}
