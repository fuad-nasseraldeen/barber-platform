/**
 * Pure availability math: working window minus breaks → grid-aligned starts with **no mutual overlap**
 * between returned options (spacing ≥ service duration on the minute grid), then minus booking overlaps.
 * No DB, no I/O — cache key unchanged; only the slot list is sparser (fewer 409s under concurrent booking).
 */

import { DateTime } from 'luxon';
import { businessLocalYmdHhmmToUtcDate } from '../common/business-local-time';

export type TimeRangeMin = { start: number; end: number }; // minutes from midnight [start, end)

function utcJs(y: number, mo: number, d: number, hh: number, mm: number): Date {
  return DateTime.utc(y, mo, d, hh, mm, 0, 0).toJSDate();
}

export function hhmmToMinutes(hhmm: string): number {
  const parts = hhmm.trim().split(':').map((p) => parseInt(p, 10));
  const h = Number.isFinite(parts[0]) ? parts[0] : 0;
  const m = Number.isFinite(parts[1]) ? parts[1] : 0;
  return h * 60 + m;
}

export function minutesToHhmm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Subtract closed ranges (breaks) from an open working interval. */
export function subtractRanges(
  working: TimeRangeMin,
  blocks: TimeRangeMin[],
): TimeRangeMin[] {
  let segments: TimeRangeMin[] = [{ ...working }];
  const sorted = [...blocks].sort((a, b) => a.start - b.start);

  for (const b of sorted) {
    const next: TimeRangeMin[] = [];
    for (const s of segments) {
      if (b.end <= s.start || b.start >= s.end) {
        next.push(s);
        continue;
      }
      if (b.start > s.start) {
        next.push({ start: s.start, end: Math.min(b.start, s.end) });
      }
      if (b.end < s.end) {
        next.push({ start: Math.max(b.end, s.start), end: s.end });
      }
    }
    segments = next.filter((x) => x.end > x.start);
  }
  return segments;
}

/**
 * Grid-aligned bookable starts. Advances like `cursor += duration`, but duration is snapped up
 * to the minute grid so every start stays on-grid (when duration already divides the grid, step === duration).
 * Replaces sliding `cursor += grid` which produced dense overlapping [start, start+duration) windows.
 */
export function buildCandidateStartsUtc(
  dateStr: string,
  freeSegments: TimeRangeMin[],
  serviceDurationMin: number,
  slotStepMin: number,
): Date[] {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const out: Date[] = [];
  const grid = Math.max(1, slotStepMin);
  const dur = Math.max(1, serviceDurationMin);
  const stepMin = Math.ceil(dur / grid) * grid;

  for (const seg of freeSegments) {
    let t = Math.ceil(seg.start / grid) * grid;
    const segEnd = Math.trunc(seg.end);
    for (;; t += stepMin) {
      const slotEnd = t + dur;
      if (slotEnd > segEnd) break;
      const hh = Math.floor(t / 60);
      const mm = t % 60;
      out.push(utcJs(y, mo, d, hh, mm));
    }
  }
  return out;
}

/**
 * Dense grid of candidate starts (every `slotStepMin`, aligned) before non-overlap packing / booking filter.
 * Used with greedy packing to maximize offered starts vs stride-only (`buildCandidateStartsUtc`).
 */
export function buildGridCandidateStartsUtc(
  dateStr: string,
  freeSegments: TimeRangeMin[],
  serviceDurationMin: number,
  slotStepMin: number,
): Date[] {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const out: Date[] = [];
  const grid = Math.max(1, slotStepMin);
  const dur = Math.max(1, serviceDurationMin);

  for (const seg of freeSegments) {
    let t = Math.ceil(seg.start / grid) * grid;
    const segEnd = Math.trunc(seg.end);
    for (;; t += grid) {
      const slotEnd = t + dur;
      if (slotEnd > segEnd) break;
      const hh = Math.floor(t / 60);
      const mm = t % 60;
      out.push(utcJs(y, mo, d, hh, mm));
    }
  }
  return out;
}

export function utcStartToHhmm(s: Date): string {
  return `${String(s.getUTCHours()).padStart(2, '0')}:${String(s.getUTCMinutes()).padStart(2, '0')}`;
}

/** Surviving starts after removing those that overlap any booking (UTC half-open intervals). */
export function filterAgainstBookingsUtc(
  starts: Date[],
  durationMs: number,
  bookings: Array<{ startTime: Date; endTime: Date }>,
): Date[] {
  const out: Date[] = [];
  for (const s of starts) {
    const e = DateTime.fromJSDate(s, { zone: 'utc' }).plus({ milliseconds: durationMs }).toJSDate();
    const clash = bookings.some((b) => overlaps(s, e, b.startTime, b.endTime));
    if (!clash) out.push(s);
  }
  return out;
}

/**
 * Maximal non-overlapping subset (same duration), greedy by ascending start — activity-selection.
 */
export function greedyNonOverlappingUtcStarts(starts: Date[], durationMs: number): Date[] {
  const sorted = [...starts].sort((a, b) => a.getTime() - b.getTime());
  const out: Date[] = [];
  let lastEnd = 0;
  for (const s of sorted) {
    const t = s.getTime();
    if (out.length === 0 || t >= lastEnd) {
      out.push(s);
      lastEnd = t + durationMs;
    }
  }
  return out;
}

export function fnv1a32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic order — same seed ⇒ same permutation (Fisher–Yates). */
export function shuffleHhmmSlotsSeeded(slots: string[], seed: string): string[] {
  if (slots.length <= 1) return [...slots];
  const a = [...slots];
  const rand = mulberry32(fnv1a32(seed) || 1);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Per-viewer slot order: seeded shuffle + rotate so first choice differs by userId (reduces booking herd).
 */
export function diversifySlotsForViewer(slots: string[], userId: string, salt: string): string[] {
  if (slots.length <= 1) return [...slots];
  const key = `${userId}|${salt}`;
  const shuffled = shuffleHhmmSlotsSeeded(slots, key);
  const k = shuffled.length > 0 ? fnv1a32(key) % shuffled.length : 0;
  return [...shuffled.slice(k), ...shuffled.slice(0, k)];
}

export function hourDistributionPercentages(slots: string[]): Record<string, number> {
  const report = buildSlotDistributionReport(slots);
  const out: Record<string, number> = {};
  if (report.slotsCount === 0) return out;
  for (const [hour, n] of report.perHour) {
    out[hour] = Math.round((n / report.slotsCount) * 1000) / 1000;
  }
  return out;
}

/** Minutes of appointment duration intersecting the UTC calendar day (approx — day already filtered). */
export function totalBookedMinutesUtcDay(appointments: Array<{ startTime: Date; endTime: Date }>): number {
  let m = 0;
  for (const a of appointments) {
    m += Math.max(0, (a.endTime.getTime() - a.startTime.getTime()) / 60000);
  }
  return Math.round(m);
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Filter starts where [start, start+duration) does not overlap any booking. */
export function filterAgainstBookings(
  starts: Date[],
  durationMs: number,
  bookings: Array<{ startTime: Date; endTime: Date }>,
): string[] {
  const hhmm: string[] = [];
  for (const s of starts) {
    const e = DateTime.fromJSDate(s, { zone: 'utc' }).plus({ milliseconds: durationMs }).toJSDate();
    const clash = bookings.some((b) => overlaps(s, e, b.startTime, b.endTime));
    if (!clash) {
      hhmm.push(
        `${String(s.getUTCHours()).padStart(2, '0')}:${String(s.getUTCMinutes()).padStart(2, '0')}`,
      );
    }
  }
  return hhmm;
}

/**
 * Cap how many starts fall in the same wall-clock hour (UTC HH) to limit UI density / herd behavior.
 * Input should be sorted or arbitrary; output is chronological within each kept slot.
 */
export function limitSlotsPerWallClockHour(
  hhmmSorted: string[],
  maxPerHour: number,
): string[] {
  if (maxPerHour <= 0 || hhmmSorted.length === 0) return hhmmSorted;
  const sorted = [...hhmmSorted].sort((a, b) => hhmmToMinutes(a) - hhmmToMinutes(b));
  const countByHour = new Map<number, number>();
  const out: string[] = [];
  for (const s of sorted) {
    const m = hhmmToMinutes(s);
    const hour = Math.floor(m / 60);
    const c = countByHour.get(hour) ?? 0;
    if (c >= maxPerHour) continue;
    countByHour.set(hour, c + 1);
    out.push(s);
  }
  return out;
}

/**
 * Round-robin merge across wall-clock hours so lists truncated by `maxSlotsPerRow` still span multiple hours.
 * (Uniform random pick from full list is unchanged; this helps clients that take `slots.slice(0, N)` in order.)
 */
export function interleaveSlotsByWallClockHour(slots: string[]): string[] {
  if (slots.length <= 1) return [...slots];
  const sorted = [...slots].sort((a, b) => hhmmToMinutes(a) - hhmmToMinutes(b));
  const byHour = new Map<number, string[]>();
  for (const s of sorted) {
    const h = Math.floor(hhmmToMinutes(s) / 60);
    const arr = byHour.get(h) ?? [];
    arr.push(s);
    byHour.set(h, arr);
  }
  const hourKeys = [...byHour.keys()].sort((a, b) => a - b);
  const out: string[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const h of hourKeys) {
      const bucket = byHour.get(h)!;
      if (bucket.length > 0) {
        out.push(bucket.shift()!);
        progress = true;
      }
    }
  }
  return out;
}

/** Fisher–Yates shuffle (copy) to spread first-pick load across listed times. */
export function shuffleHhmmSlots(slots: string[]): string[] {
  if (slots.length <= 1) return [...slots];
  const a = [...slots];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type HhmmSlotsUtcAnchor =
  | {
      /** Preferred: wall-clock slots on this calendar day in the business zone (DST-correct). */
      timeZone: string;
    }
  | {
      /** Legacy: naive UTC ms offset from local midnight (can drift on DST days if misused). */
      dayStartUtcMs: number;
    };

/** Half-open UTC [start, end) for each offered HH:mm on the business-local calendar day. */
export function hhmmSlotsToUtcIntervals(
  dateStr: string,
  slots: string[],
  durationMinutes: number,
  anchor?: HhmmSlotsUtcAnchor,
): Array<{ hhmm: string; start: Date; end: Date }> {
  const dur = Math.max(1, durationMinutes);
  const ymd = dateStr.slice(0, 10);

  return slots.map((hhmm) => {
    let start: Date;
    if (anchor && 'timeZone' in anchor) {
      start = businessLocalYmdHhmmToUtcDate(anchor.timeZone, ymd, hhmm);
    } else {
      const [y, mo, d] = ymd.split('-').map(Number);
      const baseMs =
        anchor && 'dayStartUtcMs' in anchor
          ? anchor.dayStartUtcMs
          : Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
      const mins = hhmmToMinutes(hhmm);
      start = DateTime.fromMillis(baseMs + mins * 60_000, { zone: 'utc' }).toJSDate();
    }
    const end = DateTime.fromJSDate(start, { zone: 'utc' }).plus({ minutes: dur }).toJSDate();
    return { hhmm, start, end };
  });
}

export type SlotOverlapViolation = {
  slotA: string;
  slotB: string;
  reason: string;
};

/**
 * Proves pairwise disjointness of offered bookable windows [start, start+duration) in UTC.
 * Sorts by start; O(n log n). Touching boundaries (end === next start) are OK for half-open intervals.
 */
export function findOfferedSlotOverlaps(
  dateStr: string,
  slots: string[],
  durationMinutes: number,
  anchor?: HhmmSlotsUtcAnchor,
): SlotOverlapViolation[] {
  if (slots.length <= 1) return [];
  const items = hhmmSlotsToUtcIntervals(dateStr, slots, durationMinutes, anchor);
  items.sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: SlotOverlapViolation[] = [];
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    if (cur.start.getTime() < prev.end.getTime()) {
      out.push({
        slotA: prev.hhmm,
        slotB: cur.hhmm,
        reason: `[${prev.hhmm}, +${durationMinutes}m) intersects [${cur.hhmm}, +${durationMinutes}m) (half-open [start,end))`,
      });
    }
  }
  return out;
}

export type SlotDistributionReport = {
  slotsCount: number;
  uniqueHours: number;
  /** Map hour key "HH:00" (UTC) → count */
  perHour: Map<string, number>;
  maxSlotsInOneHour: number;
  maxHourShare: number;
};

export function buildSlotDistributionReport(slots: string[]): SlotDistributionReport {
  const perHour = new Map<string, number>();
  for (const s of slots) {
    const m = hhmmToMinutes(s);
    const h = Math.floor(m / 60);
    const key = `${String(h).padStart(2, '0')}:00`;
    perHour.set(key, (perHour.get(key) ?? 0) + 1);
  }
  const slotsCount = slots.length;
  let maxSlotsInOneHour = 0;
  for (const c of perHour.values()) maxSlotsInOneHour = Math.max(maxSlotsInOneHour, c);
  const maxHourShare = slotsCount > 0 ? maxSlotsInOneHour / slotsCount : 0;
  return {
    slotsCount,
    uniqueHours: perHour.size,
    perHour,
    maxSlotsInOneHour,
    maxHourShare,
  };
}

/** Human-readable histogram lines for logs. */
export function formatSlotDistributionHistogram(report: SlotDistributionReport): string {
  const rows = [...report.perHour.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return rows.map(([hour, n]) => `  ${hour} → ${n}`).join('\n');
}

/**
 * Heuristics for load-test / ops: sparse or clustered offerings raise contention risk even without pairwise overlap.
 */
export function lowEntropyContentionWarnings(
  report: SlotDistributionReport,
  opts?: { minSlots?: number; maxHourShare?: number },
): string[] {
  const minSlots = opts?.minSlots ?? 5;
  const maxShare = opts?.maxHourShare ?? 0.5;
  const w: string[] = [];
  if (report.slotsCount > 0 && report.slotsCount < minSlots) {
    w.push(`few_slots(count=${report.slotsCount} < ${minSlots})`);
  }
  if (report.slotsCount > 0 && report.uniqueHours === 1 && report.slotsCount >= 3) {
    w.push('all_slots_in_single_clock_hour');
  }
  if (report.maxHourShare > maxShare) {
    w.push(`hour_clustering(maxShare=${report.maxHourShare.toFixed(2)} > ${maxShare})`);
  }
  return w;
}
