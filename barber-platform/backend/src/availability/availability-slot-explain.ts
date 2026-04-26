import type { MinuteInterval } from './interval-availability.engine';

/** Rejection reasons for internal GET /availability/debug (ordered checks in {@link explainSlotDecision}). */
export type SlotDebugRejectReasonExcludeHoliday =
  | 'overlap_booking'
  | 'overlap_hold'
  | 'outside_working_hours'
  | 'break_time';

export type SlotDebugRejectReason = SlotDebugRejectReasonExcludeHoliday | 'holiday';

export type ExplainSlotContext = {
  workingWindowMinutes: { start: number; end: number };
  /** Weekly + exception breaks, merged, minutes from local midnight. */
  breaksMerged: MinuteInterval[];
  /** Bookings only (minutes), merged. */
  bookingBusy: MinuteInterval[];
  /** Active holds only (minutes), merged. */
  holdBusy: MinuteInterval[];
  serviceDurationMinutes: number;
  stepMinutes: number;
};

function windowIntersectsBusy(candidateStartMin: number, candidateEndMin: number, busy: MinuteInterval[]): boolean {
  for (const b of busy) {
    if (candidateStartMin < b.end && candidateEndMin > b.start) return true;
  }
  return false;
}

/**
 * Single candidate start (minutes from business-local midnight). Half-open service window
 * [start, start + duration). First failing rule wins: outside WH → break → booking → hold.
 */
export function explainSlotDecision(
  candidateStartMin: number,
  ctx: ExplainSlotContext,
): { ok: true } | { ok: false; reason: SlotDebugRejectReasonExcludeHoliday } {
  const dur = Math.max(1, Math.floor(ctx.serviceDurationMinutes));
  const t0 = candidateStartMin;
  const t1 = candidateStartMin + dur;
  const wh = ctx.workingWindowMinutes;

  if (t0 < wh.start || t1 > wh.end) {
    return { ok: false, reason: 'outside_working_hours' };
  }
  if (windowIntersectsBusy(t0, t1, ctx.breaksMerged)) {
    return { ok: false, reason: 'break_time' };
  }
  if (windowIntersectsBusy(t0, t1, ctx.bookingBusy)) {
    return { ok: false, reason: 'overlap_booking' };
  }
  if (windowIntersectsBusy(t0, t1, ctx.holdBusy)) {
    return { ok: false, reason: 'overlap_hold' };
  }
  return { ok: true };
}

/** Same stride as {@link interval-availability.engine} `eachGridAlignedSlotStartInFreeInterval` (from window start). */
export function enumerateGridCandidateStarts(
  whStart: number,
  whEnd: number,
  durationMin: number,
  stepMinutes: number,
): number[] {
  const dur = Math.max(1, Math.floor(Math.trunc(durationMin)));
  const step = Math.max(1, Math.floor(Math.trunc(stepMinutes)));
  const a = Math.trunc(whStart);
  const b = Math.trunc(whEnd);
  if (b <= a || a + dur > b) return [];
  const out: number[] = [];
  for (let t = a; ; t += step) {
    const slotEnd = t + dur;
    if (slotEnd > b) break;
    out.push(t);
  }
  return out;
}
