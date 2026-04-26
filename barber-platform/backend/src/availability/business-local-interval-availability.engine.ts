/**
 * Business-local day availability: single timeline = integer minutes from local midnight on `ymd`
 * in `timeZone`. Half-open intervals [start, end). All wall times (HH:mm) normalized before use;
 * UTC instants are clipped to the local calendar day first, then converted to minutes.
 *
 * Pipeline: workingInterval − busy[] → free[] → slot starts (grid step, full service block inside free).
 */

import { businessLocalDayBounds } from '../common/business-local-time';
import { hhmmToMinutes, subtractRanges } from './simple-availability.engine';
import { mergeMinuteIntervals, type MinuteInterval } from './interval-availability.engine';

export type { MinuteInterval };

export function normalizeMinuteInterval(i: MinuteInterval): MinuteInterval {
  return { start: Math.trunc(i.start), end: Math.trunc(i.end) };
}

/** Wall clock "HH:mm" (24h) → minutes from local midnight. */
export function wallHhmmToMinuteOfDay(hhmm: string): number {
  return hhmmToMinutes(hhmm);
}

/** Working day segment from staff working hours strings (already in business-local wall clock). */
export function buildWorkingIntervalFromHhmm(startHhmm: string, endHhmm: string): MinuteInterval {
  return normalizeMinuteInterval({
    start: wallHhmmToMinuteOfDay(startHhmm),
    end: wallHhmmToMinuteOfDay(endHhmm),
  });
}

/** Merge overlapping / touching busy intervals (bookings, holds, breaks, …). */
export function mergeBusyIntervals(busy: MinuteInterval[]): MinuteInterval[] {
  if (busy.length === 0) return [];
  return mergeMinuteIntervals(busy.map(normalizeMinuteInterval));
}

/**
 * Subtract merged busy from the working interval → list of free half-open fragments.
 * Same algebra as “working minus blocks” in the legacy engine; kept here as the canonical API.
 */
export function subtractBusyFromWorkingWindow(
  working: MinuteInterval,
  busy: MinuteInterval[],
): MinuteInterval[] {
  const w = normalizeMinuteInterval(working);
  if (w.end <= w.start) return [];
  const blocks = mergeBusyIntervals(busy);
  if (blocks.length === 0) return [w];
  return subtractRanges(w, blocks).map(normalizeMinuteInterval);
}

/** Clip a free fragment to the working window (integer minutes); drops empty / inverted results. */
export function clampFreeIntervalToWorkingWindow(
  free: MinuteInterval,
  working: MinuteInterval,
): MinuteInterval | null {
  const w = normalizeMinuteInterval(working);
  const f = normalizeMinuteInterval(free);
  const start = Math.max(f.start, w.start);
  const end = Math.min(f.end, w.end);
  if (end <= start) return null;
  return { start, end };
}

/**
 * Clip UTC booking/hold interval to business-local calendar day `ymd`, return busy minutes [start, end).
 * Returns null if no overlap with that local day.
 */
export function utcSpanToLocalDayBusyInterval(
  startTime: Date,
  endTime: Date,
  ymd: string,
  timeZone: string,
): MinuteInterval | null {
  const day = ymd.slice(0, 10);
  const { startMs: t0, endMs: t1 } = businessLocalDayBounds(timeZone, day);
  const s = Math.max(startTime.getTime(), t0);
  const e = Math.min(endTime.getTime(), t1);
  if (s >= e) return null;
  const startFloored = Math.max(0, Math.floor((s - t0) / 60_000));
  const endCeiled = Math.min(24 * 60, Math.ceil((e - t0) / 60_000));
  if (endCeiled <= startFloored) return null;
  return { start: startFloored, end: endCeiled };
}

/** Break / exception rows already interpreted in business-local wall time for that day. */
export function breakHhmmToBusyInterval(startHhmm: string, endHhmm: string): MinuteInterval {
  return buildWorkingIntervalFromHhmm(startHhmm, endHhmm);
}

/**
 * Bookable starts for one day: only from free half-open segments [start, end).
 *
 * For each segment, stride from **segment start** by `stepMinutes`. A start is pushed only after
 * `slotEnd = t + duration` is computed and `slotEnd <= interval.end` (never push then filter).
 * All bounds are integer minutes — avoids float leakage from upstream ms math widening `[start,end)`.
 */
export function generateSlotStartsFromFreeIntervals(
  freeIntervals: MinuteInterval[],
  serviceDurationMinutes: number,
  stepMinutes: number,
): number[] {
  const dur = Math.max(1, Math.floor(Math.trunc(serviceDurationMinutes)));
  const step = Math.max(1, Math.floor(Math.trunc(stepMinutes)));
  const out: number[] = [];

  for (const raw of freeIntervals) {
    const seg = normalizeMinuteInterval(raw);
    const segStart = seg.start;
    const segEnd = seg.end;
    if (segEnd <= segStart || segStart + dur > segEnd) continue;

    for (let t = segStart; ; t += step) {
      const slotEnd = t + dur;
      if (slotEnd > segEnd) break;
      out.push(t);
    }
  }

  out.sort((a, b) => a - b);
  return out;
}

/** Count theoretical starts (metrics) without building a large array. */
export function countSlotStartsInFreeIntervals(
  freeIntervals: MinuteInterval[],
  serviceDurationMinutes: number,
  stepMinutes: number,
): number {
  return generateSlotStartsFromFreeIntervals(
    freeIntervals,
    serviceDurationMinutes,
    stepMinutes,
  ).length;
}

/**
 * One-shot: working window minus merged busy (breaks + holds + appointments already merged) → slot starts.
 */
export function computeSlotStartsFromWorkingAndBusy(
  workingStartHhmm: string,
  workingEndHhmm: string,
  busyMerged: MinuteInterval[],
  serviceDurationMinutes: number,
  stepMinutes: number,
): { working: MinuteInterval; freeIntervals: MinuteInterval[]; slotStartMinutes: number[] } {
  const working = buildWorkingIntervalFromHhmm(workingStartHhmm, workingEndHhmm);
  const rawFree = subtractBusyFromWorkingWindow(working, busyMerged);
  const freeIntervals: MinuteInterval[] = [];
  for (const f of rawFree) {
    const clamped = clampFreeIntervalToWorkingWindow(f, working);
    if (clamped) freeIntervals.push(clamped);
  }
  const slotStartMinutes = generateSlotStartsFromFreeIntervals(
    freeIntervals,
    serviceDurationMinutes,
    stepMinutes,
  );

  if (process.env.AVAILABILITY_ASSERT_FREE_IN_WORKING === '1') {
    for (const f of freeIntervals) {
      if (f.start < working.start || f.end > working.end) {
        throw new Error(
          `FREE_INTERVAL_OUTSIDE_WORKING: free [${f.start}, ${f.end}) ` +
            `not subset of working [${working.start}, ${working.end}) — check busyMerged / subtract / cache`,
        );
      }
    }
  }

  return { working, freeIntervals, slotStartMinutes };
}
