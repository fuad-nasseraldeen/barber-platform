/**
 * Standalone core availability: pure minutes-from-midnight, no I/O.
 * Not part of the production Nest availability stack.
 */

export type Booking = {
  start: number;
  end: number;
};

export type Input = {
  workingStart: number;
  workingEnd: number;
  bookings: Booking[];
  duration: number;
  step: number;
};

/** Strict overlap on half-open-style minute segments (same predicate as spec). */
export function overlaps(a: Booking, b: Booking): boolean {
  return a.start < b.end && a.end > b.start;
}

export function computeSlots(input: Input): number[] {
  const { workingStart, workingEnd, bookings, duration, step } = input;
  const result: number[] = [];

  for (
    let candidate = workingStart;
    candidate + duration <= workingEnd;
    candidate += step
  ) {
    const slot: Booking = {
      start: candidate,
      end: candidate + duration,
    };

    let blocked = false;
    for (const b of bookings) {
      if (overlaps(slot, b)) {
        blocked = true;
        break;
      }
    }

    if (!blocked) {
      result.push(candidate);
    }
  }

  return result;
}

/** Render minutes-from-midnight as HH:mm (24h). */
export function minutesToHhmm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Slots as HH:mm for logging / demos. */
export function slotsToHhmm(slots: number[]): string[] {
  return slots.map(minutesToHhmm);
}
