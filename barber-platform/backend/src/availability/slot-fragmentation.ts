/**
 * Second layer after interval availability: rank or filter offered starts by how much
 * they fragment remaining free time. Does not change which starts are valid.
 */

import type { ComputeAvailabilityInput, MinuteInterval } from './interval-availability.engine';
import {
  computeAvailability,
  mergeMinuteIntervals,
  subtractIntervals,
} from './interval-availability.engine';

export type UtcBookableWindow = { start: Date; end: Date };

export type EvaluateSlotQualityParams = {
  /**
   * Working time minus breaks only — same `afterBreaks` used before subtracting bookings
   * in `computeAvailability`.
   */
  freeSegments: MinuteInterval[];
  /** Booked busy intervals (minutes from local midnight), usually pre-merged. */
  bookings: MinuteInterval[];
  /** Candidate start on the same minute timeline as `bookings`. */
  candidateStart: number;
  /** Length of the candidate booking in minutes (service + buffers in the availability pipeline). */
  duration: number;
  /**
   * Free fragments shorter than this (minutes) are treated as unusable for standard services
   * and are heavily penalized; {@link strictMode} rejects them outright.
   */
  minServiceDuration: number;
  strictMode?: boolean;
};

/** Penalty per extra free fragment (prefers fewer gaps). */
const GAP_COUNT_WEIGHT = 15;

/** Quadratic penalty per minute a gap falls short of `minServiceDuration`. */
const SMALL_GAP_DEFICIT_WEIGHT = 6;

/** Bonus when candidate is flush against an existing booking (tight packing). */
const ADJACENCY_BONUS = 40;

function assertNonNegativeMinutes(n: number, label: string): void {
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

function normalizedCandidate(
  candidateStart: number,
  duration: number,
): MinuteInterval {
  const start = Math.round(candidateStart);
  const dur = Math.max(1, Math.round(duration));
  if (!Number.isFinite(start)) {
    throw new Error('candidateStart must be finite');
  }
  return { start, end: start + dur };
}

/**
 * Adjacency in the half-open grid: candidate starts exactly when a booking ends, or ends
 * exactly when the next booking starts.
 */
export function adjacencyTouchCount(candidate: MinuteInterval, bookings: MinuteInterval[]): number {
  if (bookings.length === 0) return 0;
  const { start: cs, end: ce } = candidate;
  let n = 0;
  for (const b of bookings) {
    if (b.end === cs || ce === b.start) n++;
  }
  return n;
}

/**
 * Insert candidate into existing bookings, subtract from `freeSegments`, score remaining gaps.
 * Higher is better. With `strictMode`, returns `-Infinity` when any remaining gap is in
 * `(0, minServiceDuration)`.
 */
export function evaluateSlotQuality(params: EvaluateSlotQualityParams): number {
  const {
    freeSegments,
    bookings,
    candidateStart,
    duration,
    strictMode = false,
  } = params;
  const minBlock = Math.max(1, Math.floor(params.minServiceDuration));

  assertNonNegativeMinutes(candidateStart, 'candidateStart');
  assertNonNegativeMinutes(duration, 'duration');

  const candidate = normalizedCandidate(candidateStart, duration);
  const mergedBusy = mergeMinuteIntervals([
    ...bookings.map((b) => ({ ...b })),
    { start: candidate.start, end: candidate.end },
  ]);
  const newFree = subtractIntervals(freeSegments, mergedBusy);

  let score = 0;

  for (const g of newFree) {
    const L = g.end - g.start;
    if (L <= 0) continue;
    score += L * L;
    if (L < minBlock) {
      const deficit = minBlock - L;
      score -= SMALL_GAP_DEFICIT_WEIGHT * deficit * deficit;
      if (strictMode) {
        return Number.NEGATIVE_INFINITY;
      }
    }
  }

  score -= GAP_COUNT_WEIGHT * newFree.filter((g) => g.end > g.start).length;
  score += ADJACENCY_BONUS * adjacencyTouchCount(candidate, bookings);

  return score;
}

export type ValidateBookingFragmentationParams = EvaluateSlotQualityParams & {
  /**
   * When `strictMode` is false, booking is rejected if `score` falls below this.
   * Ignored when `strictMode` is true (only `score === -Infinity` rejects).
   */
  minScoreThreshold: number;
};

/**
 * Server-side guard: same scoring as ranked availability. `score` is from {@link evaluateSlotQuality}
 * using the provided `strictMode`.
 */
export function validateBookingAgainstFragmentation(
  params: ValidateBookingFragmentationParams,
): { allowed: boolean; score: number } {
  const score = evaluateSlotQuality(params);
  if (params.strictMode) {
    const allowed =
      Number.isFinite(score) && score !== Number.NEGATIVE_INFINITY;
    return { allowed, score };
  }
  const allowed = score >= params.minScoreThreshold;
  return { allowed, score };
}

/**
 * Rank other valid starts (same pipeline as GET availability) and return local start minutes
 * for the top-N options that pass {@link validateBookingAgainstFragmentation}.
 */
export function pickTopAlternativeSlotMinutes(
  availInput: ComputeAvailabilityInput,
  opts: {
    afterBreaks: MinuteInterval[];
    durationMinutes: number;
    minServiceDuration: number;
    strictMode: boolean;
    minScoreThreshold: number;
    excludeStartMin: number | null;
    topN: number;
    dayStartUtcMs: number;
  },
): number[] {
  const windows = computeAvailability(availInput);
  const scored: Array<{ startMin: number; score: number }> = [];
  for (const w of windows) {
    const startMin = Math.round((w.start.getTime() - opts.dayStartUtcMs) / 60_000);
    if (opts.excludeStartMin != null && startMin === opts.excludeStartMin) {
      continue;
    }
    const { allowed, score } = validateBookingAgainstFragmentation({
      freeSegments: opts.afterBreaks,
      bookings: availInput.busyFromBookings,
      candidateStart: startMin,
      duration: opts.durationMinutes,
      minServiceDuration: opts.minServiceDuration,
      strictMode: opts.strictMode,
      minScoreThreshold: opts.minScoreThreshold,
    });
    if (!allowed) continue;
    scored.push({ startMin, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const out: number[] = [];
  const seen = new Set<number>();
  for (const row of scored) {
    if (seen.has(row.startMin)) continue;
    seen.add(row.startMin);
    out.push(row.startMin);
    if (out.length >= opts.topN) break;
  }
  return out;
}

export type RankSlotsByFragmentationParams = Omit<
  EvaluateSlotQualityParams,
  'candidateStart' | 'duration' | 'strictMode'
> & {
  /** Same as bookable window length passed to `computeAvailability` (service + buffers). */
  duration: number;
  dayStartUtcMs: number;
  strictMode?: boolean;
};

/** Minute-based ranking: same scoring inputs as {@link RankSlotsByFragmentationParams} except no UTC anchor. */
export type RankSlotMinutesByFragmentationParams = Omit<
  RankSlotsByFragmentationParams,
  'dayStartUtcMs'
>;

/**
 * Reorders valid UTC slot windows (same shape as `computeAvailability` output).
 * Drops strict-rejected slots when `strictMode` is true.
 */
export function rankOfferedSlotsByFragmentation(
  slots: UtcBookableWindow[],
  params: RankSlotsByFragmentationParams,
): UtcBookableWindow[] {
  if (slots.length <= 1) return slots;

  const {
    freeSegments,
    bookings,
    duration: durationMin,
    minServiceDuration,
    dayStartUtcMs,
    strictMode = false,
  } = params;

  const scored = slots.map((slot) => {
    const startMin = Math.round((slot.start.getTime() - dayStartUtcMs) / 60_000);
    const score = evaluateSlotQuality({
      freeSegments,
      bookings,
      candidateStart: startMin,
      duration: durationMin,
      minServiceDuration,
      strictMode,
    });
    return { slot, score };
  });

  const keep = strictMode
    ? scored.filter((x) => Number.isFinite(x.score) && x.score !== Number.NEGATIVE_INFINITY)
    : scored;

  keep.sort((a, b) => b.score - a.score);
  return keep.map((x) => x.slot);
}

/** Same ordering as {@link rankOfferedSlotsByFragmentation} without constructing `Date` per slot. */
export function rankOfferedSlotMinutesByFragmentation(
  startMinutes: number[],
  params: RankSlotMinutesByFragmentationParams,
): number[] {
  if (startMinutes.length <= 1) return startMinutes;

  const {
    freeSegments,
    bookings,
    duration: durationMin,
    minServiceDuration,
    strictMode = false,
  } = params;

  const scored = startMinutes.map((startMin) => {
    const score = evaluateSlotQuality({
      freeSegments,
      bookings,
      candidateStart: startMin,
      duration: durationMin,
      minServiceDuration,
      strictMode,
    });
    return { startMin, score };
  });

  const keep = strictMode
    ? scored.filter((x) => Number.isFinite(x.score) && x.score !== Number.NEGATIVE_INFINITY)
    : scored;

  keep.sort((a, b) => b.score - a.score);
  return keep.map((x) => x.startMin);
}
