/**
 * Scheduling v2 — interval primitives (millisecond timeline, UTC-safe if callers use UTC instants).
 */

/** Closed-open semantic in math: [startMs, endMs) — end is exclusive for adjacency. */
export type MsInterval = {
  readonly startMs: number;
  readonly endMs: number;
};

export function intervalFromDates(start: Date, end: Date): MsInterval {
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export function intervalToSlot(startMs: number, endMs: number): {
  start: Date;
  end: Date;
} {
  return { start: new Date(startMs), end: new Date(endMs) };
}

export function assertValidInterval(i: MsInterval): void {
  if (!(Number.isFinite(i.startMs) && Number.isFinite(i.endMs)) || i.startMs >= i.endMs) {
    throw new Error('Invalid interval: require startMs < endMs');
  }
}
