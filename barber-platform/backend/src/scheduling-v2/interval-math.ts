/**
 * Pure interval algebra for scheduling v2.
 * Semantics: intervals are half-open [start, end) in milliseconds unless noted.
 */

import type { MsInterval } from './interval-types';
import { assertValidInterval } from './interval-types';

function sortByStart(a: MsInterval, b: MsInterval): number {
  return a.startMs - b.startMs || a.endMs - b.endMs;
}

/**
 * Merge overlapping or adjacent intervals into a minimal covering set.
 * Adjacent: [a,b) + [b,c) → [a,c)
 */
export function mergeIntervals(intervals: MsInterval[]): MsInterval[] {
  if (intervals.length === 0) return [];
  for (const i of intervals) assertValidInterval(i);
  const sorted = [...intervals].sort(sortByStart);
  const out: MsInterval[] = [];
  let cur = { ...sorted[0]! };
  for (let k = 1; k < sorted.length; k++) {
    const n = sorted[k]!;
    if (n.startMs <= cur.endMs) {
      cur = { startMs: cur.startMs, endMs: Math.max(cur.endMs, n.endMs) };
    } else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}

/**
 * Subtract one blocker from one base interval; returns 0–2 fragments (half-open).
 */
export function subtractOne(base: MsInterval, block: MsInterval): MsInterval[] {
  assertValidInterval(base);
  assertValidInterval(block);
  const { startMs: a0, endMs: a1 } = base;
  const { startMs: b0, endMs: b1 } = block;
  if (b1 <= a0 || b0 >= a1) return [{ startMs: a0, endMs: a1 }];
  const out: MsInterval[] = [];
  if (a0 < b0) out.push({ startMs: a0, endMs: Math.min(b0, a1) });
  if (b1 < a1) out.push({ startMs: Math.max(b1, a0), endMs: a1 });
  return out.filter((x) => x.endMs > x.startMs);
}

/**
 * Carve `baseIntervals` by removing all `blockedIntervals` (merged first).
 */
export function subtractIntervals(
  baseIntervals: MsInterval[],
  blockedIntervals: MsInterval[],
): MsInterval[] {
  if (baseIntervals.length === 0) return [];
  let current = mergeIntervals(baseIntervals);
  if (blockedIntervals.length === 0) return current;
  const blocks = mergeIntervals(blockedIntervals);
  for (const b of blocks) {
    current = current.flatMap((fragment) => subtractOne(fragment, b));
  }
  return mergeIntervals(current);
}

const MINUTE_MS = 60_000;

/**
 * All valid service placements inside one free interval: [t, t+duration) ⊆ [free.start, free.end).
 * Steps advance `stepMinutes` from free.start (no fixed global grid alignment).
 */
export function generateSlotsFromInterval(
  free: MsInterval,
  durationMinutes: number,
  stepMinutes: number,
): { start: Date; end: Date }[] {
  assertValidInterval(free);
  if (durationMinutes <= 0 || stepMinutes <= 0) return [];
  const durationMs = durationMinutes * MINUTE_MS;
  const stepMs = stepMinutes * MINUTE_MS;
  const slots: { start: Date; end: Date }[] = [];
  for (let t = free.startMs; t + durationMs <= free.endMs; t += stepMs) {
    slots.push({
      start: new Date(t),
      end: new Date(t + durationMs),
    });
  }
  return slots;
}
