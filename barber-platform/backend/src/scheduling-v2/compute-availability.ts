/**
 * Availability engine v2: free time from interval math, then discrete start times (step-based).
 */

import { intervalFromDates } from './interval-types';
import { mergeIntervals, subtractIntervals, generateSlotsFromInterval } from './interval-math';

export type DateInterval = { start: Date; end: Date };

export type ComputeAvailabilityInput = {
  workingHours: DateInterval[];
  breaks: DateInterval[];
  bookings: DateInterval[];
  serviceDurationMinutes: number;
  /** Grid for *start* times only; default 5. */
  stepMinutes?: number;
};

/**
 * 1) free = workingHours − breaks − bookings (interval math only)
 * 2) For each free fragment, emit starts t where [t, t+duration] ⊆ fragment (half-open [t,t+duration))
 */
export function computeAvailability(
  input: ComputeAvailabilityInput,
): { start: Date; end: Date }[] {
  const step = input.stepMinutes ?? 5;
  const wh = mergeIntervals(input.workingHours.map((w) => intervalFromDates(w.start, w.end)));
  const br = input.breaks.map((b) => intervalFromDates(b.start, b.end));
  const bk = input.bookings.map((b) => intervalFromDates(b.start, b.end));
  const free = subtractIntervals(subtractIntervals(wh, br), bk);
  const out: { start: Date; end: Date }[] = [];
  for (const fragment of free) {
    out.push(
      ...generateSlotsFromInterval(
        fragment,
        input.serviceDurationMinutes,
        step,
      ),
    );
  }
  return out;
}
