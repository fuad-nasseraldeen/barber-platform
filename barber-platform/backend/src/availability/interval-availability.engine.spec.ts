import {
  computeAvailabilityStartMinutes,
  eachGridAlignedSlotStartInFreeInterval,
  slotBlockFitsFreeInterval,
  normalizeMinuteInterval,
} from './interval-availability.engine';

describe('interval-availability.engine slot generation', () => {
  /** Working hours 09:00–18:00 in minutes: [540, 1080) half-open. */
  const wh: { start: number; end: number } = { start: 540, end: 1080 };

  it('WH 09:00–18:00, duration 55, step 5: last slot 17:05; 17:25 must not appear', () => {
    const starts = computeAvailabilityStartMinutes({
      dateStr: '2026-06-15',
      workingWindow: wh,
      breaksAndExceptions: [],
      busyFromBookings: [],
      serviceDurationMinutes: 55,
      stepMinutes: 5,
    });

    expect(starts).toContain(540); // 09:00
    expect(starts).toContain(1025); // 17:05 — last valid (1025 + 55 = 1080)
    expect(starts[starts.length - 1]).toBe(1025);
    expect(starts).not.toContain(1030); // 17:10 — would end 18:05
    expect(starts).not.toContain(1045); // 17:25 — would end 18:20

    expect(slotBlockFitsFreeInterval(1025, 55, wh)).toBe(true);
    expect(slotBlockFitsFreeInterval(1045, 55, wh)).toBe(false);
    expect(slotBlockFitsFreeInterval(1030, 55, wh)).toBe(false);
  });

  it('exact boundary: block end may equal interval end', () => {
    const free = { start: 540, end: 1080 };
    expect(slotBlockFitsFreeInterval(1050, 30, free)).toBe(true); // 17:30–18:00
    expect(slotBlockFitsFreeInterval(1050, 31, free)).toBe(false);
    expect(slotBlockFitsFreeInterval(980, 100, free)).toBe(true); // 16:20–18:00
    expect(slotBlockFitsFreeInterval(1065, 100, free)).toBe(false); // 17:45 would end 19:15
  });

  it('WH 09:00–18:00, duration 100, step 5: last slot 16:20 (980)', () => {
    const starts = computeAvailabilityStartMinutes({
      dateStr: '2026-06-15',
      workingWindow: wh,
      breaksAndExceptions: [],
      busyFromBookings: [],
      serviceDurationMinutes: 100,
      stepMinutes: 5,
    });
    expect(starts[starts.length - 1]).toBe(980);
    expect(starts).not.toContain(1065);
  });

  it('WH 09:00–18:00, duration 25, step 5: last slot 17:35 (1055)', () => {
    const starts = computeAvailabilityStartMinutes({
      dateStr: '2026-06-15',
      workingWindow: wh,
      breaksAndExceptions: [],
      busyFromBookings: [],
      serviceDurationMinutes: 25,
      stepMinutes: 5,
    });
    expect(starts[starts.length - 1]).toBe(1055);
  });

  it('eachGridAlignedSlotStartInFreeInterval matches fit predicate for every t', () => {
    const free = { start: 540, end: 1080 };
    const dur = 55;
    const step = 5;
    const starts = eachGridAlignedSlotStartInFreeInterval(free, dur, step);
    for (const t of starts) {
      expect(slotBlockFitsFreeInterval(t, dur, normalizeMinuteInterval(free))).toBe(true);
      expect(t).toBeGreaterThanOrEqual(free.start);
      expect(t + dur).toBeLessThanOrEqual(free.end);
    }
  });

  it('short service still yields many starts', () => {
    const starts = computeAvailabilityStartMinutes({
      dateStr: '2026-06-15',
      workingWindow: wh,
      breaksAndExceptions: [],
      busyFromBookings: [],
      serviceDurationMinutes: 15,
      stepMinutes: 5,
    });
    expect(starts.length).toBeGreaterThan(50);
    const last = starts[starts.length - 1]!;
    expect(last + 15).toBeLessThanOrEqual(1080);
  });

  it('free interval after busy: block must not exceed fragment end', () => {
    const busy = [{ start: 540, end: 600 }];
    const starts = computeAvailabilityStartMinutes({
      dateStr: '2026-06-15',
      workingWindow: wh,
      breaksAndExceptions: [],
      busyFromBookings: busy,
      serviceDurationMinutes: 55,
      stepMinutes: 5,
    });
    for (const t of starts) {
      expect(t + 55).toBeLessThanOrEqual(1080);
      expect(t).toBeGreaterThanOrEqual(600);
    }
    expect(starts).not.toContain(1045);
  });
});
