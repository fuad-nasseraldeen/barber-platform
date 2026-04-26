import {
  evaluateSlotQuality,
  adjacencyTouchCount,
  rankOfferedSlotsByFragmentation,
  validateBookingAgainstFragmentation,
  pickTopAlternativeSlotMinutes,
} from './slot-fragmentation';

describe('slot fragmentation', () => {
  const free = [{ start: 0, end: 60 }];

  it('penalizes small leftover gaps vs larger ones (non-strict)', () => {
    const better = evaluateSlotQuality({
      freeSegments: free,
      bookings: [],
      candidateStart: 0,
      duration: 25,
      minServiceDuration: 30,
    });
    const worse = evaluateSlotQuality({
      freeSegments: free,
      bookings: [],
      candidateStart: 0,
      duration: 50,
      minServiceDuration: 30,
    });
    expect(better).toBeGreaterThan(worse);
  });

  it('strictMode rejects when a gap is shorter than minServiceDuration', () => {
    const ok = evaluateSlotQuality({
      freeSegments: free,
      bookings: [],
      candidateStart: 0,
      duration: 25,
      minServiceDuration: 30,
      strictMode: true,
    });
    expect(Number.isFinite(ok)).toBe(true);

    const bad = evaluateSlotQuality({
      freeSegments: [{ start: 0, end: 55 }],
      bookings: [],
      candidateStart: 0,
      duration: 30,
      minServiceDuration: 30,
      strictMode: true,
    });
    expect(bad).toBe(Number.NEGATIVE_INFINITY);
  });

  it('rewards adjacency to existing bookings', () => {
    const bookings = [{ start: 0, end: 30 }];
    const flush = evaluateSlotQuality({
      freeSegments: free,
      bookings,
      candidateStart: 30,
      duration: 15,
      minServiceDuration: 15,
    });
    const gap = evaluateSlotQuality({
      freeSegments: free,
      bookings,
      candidateStart: 35,
      duration: 15,
      minServiceDuration: 15,
    });
    expect(flush).toBeGreaterThan(gap);
  });

  it('adjacencyTouchCount detects half-open flush joins', () => {
    expect(adjacencyTouchCount({ start: 30, end: 45 }, [{ start: 0, end: 30 }])).toBe(1);
    expect(adjacencyTouchCount({ start: 20, end: 30 }, [{ start: 30, end: 60 }])).toBe(1);
    expect(adjacencyTouchCount({ start: 31, end: 45 }, [{ start: 0, end: 30 }])).toBe(0);
  });

  it('rankOfferedSlotsByFragmentation sorts DESC and filters strict', () => {
    const dayStartUtcMs = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
    const wideFree = [{ start: 0, end: 120 }];
    const slots = [
      { start: new Date(dayStartUtcMs + 50 * 60_000), end: new Date(dayStartUtcMs + 75 * 60_000) },
      { start: new Date(dayStartUtcMs), end: new Date(dayStartUtcMs + 25 * 60_000) },
    ];
    const ranked = rankOfferedSlotsByFragmentation(slots, {
      freeSegments: wideFree,
      bookings: [],
      duration: 25,
      minServiceDuration: 15,
      dayStartUtcMs,
    });
    expect(ranked[0]!.start.getTime()).toBe(dayStartUtcMs);

    const strictSlots = [
      { start: new Date(dayStartUtcMs), end: new Date(dayStartUtcMs + 30 * 60_000) },
      { start: new Date(dayStartUtcMs + 5 * 60_000), end: new Date(dayStartUtcMs + 35 * 60_000) },
    ];
    const strict = rankOfferedSlotsByFragmentation(strictSlots, {
      freeSegments: [{ start: 0, end: 55 }],
      bookings: [],
      duration: 30,
      minServiceDuration: 30,
      dayStartUtcMs,
      strictMode: true,
    });
    expect(strict.length).toBe(0);
  });

  it('validateBookingAgainstFragmentation: strict rejects -Infinity scores', () => {
    const r = validateBookingAgainstFragmentation({
      freeSegments: [{ start: 0, end: 55 }],
      bookings: [],
      candidateStart: 0,
      duration: 30,
      minServiceDuration: 30,
      strictMode: true,
      minScoreThreshold: 0,
    });
    expect(r.allowed).toBe(false);
    expect(r.score).toBe(Number.NEGATIVE_INFINITY);
  });

  it('validateBookingAgainstFragmentation: non-strict uses minScoreThreshold', () => {
    const pass = validateBookingAgainstFragmentation({
      freeSegments: [{ start: 0, end: 60 }],
      bookings: [],
      candidateStart: 0,
      duration: 25,
      minServiceDuration: 30,
      strictMode: false,
      minScoreThreshold: -1_000_000,
    });
    expect(pass.allowed).toBe(true);

    const fail = validateBookingAgainstFragmentation({
      freeSegments: [{ start: 0, end: 60 }],
      bookings: [],
      candidateStart: 0,
      duration: 25,
      minServiceDuration: 30,
      strictMode: false,
      minScoreThreshold: 1_000_000,
    });
    expect(fail.allowed).toBe(false);
  });

  it('pickTopAlternativeSlotMinutes returns better-ranked starts', () => {
    const dayStartUtcMs = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
    const afterBreaks = [{ start: 0, end: 120 }];
    const mins = pickTopAlternativeSlotMinutes(
      {
        dateStr: '2026-01-01',
        workingWindow: { start: 0, end: 120 },
        breaksAndExceptions: [],
        busyFromBookings: [],
        serviceDurationMinutes: 25,
        stepMinutes: 30,
        dayStartUtcMs,
      },
      {
        afterBreaks,
        durationMinutes: 25,
        minServiceDuration: 15,
        strictMode: false,
        minScoreThreshold: 0,
        excludeStartMin: 60,
        topN: 3,
        dayStartUtcMs,
      },
    );
    expect(mins.length).toBeGreaterThan(0);
    expect(mins.includes(60)).toBe(false);
  });
});
