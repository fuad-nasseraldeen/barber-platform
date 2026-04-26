import { mergeIntervals, subtractIntervals, generateSlotsFromInterval } from './interval-math';
import { computeAvailability } from './compute-availability';

describe('scheduling-v2 interval math', () => {
  const t = (iso: string) => new Date(iso).getTime();

  it('mergeIntervals merges overlap', () => {
    const m = mergeIntervals([
      { startMs: t('2026-01-01T09:00:00.000Z'), endMs: t('2026-01-01T10:00:00.000Z') },
      { startMs: t('2026-01-01T09:30:00.000Z'), endMs: t('2026-01-01T11:00:00.000Z') },
    ]);
    expect(m).toEqual([
      { startMs: t('2026-01-01T09:00:00.000Z'), endMs: t('2026-01-01T11:00:00.000Z') },
    ]);
  });

  it('subtractIntervals removes break from work', () => {
    const free = subtractIntervals(
      [{ startMs: t('2026-01-01T09:00:00.000Z'), endMs: t('2026-01-01T17:00:00.000Z') }],
      [{ startMs: t('2026-01-01T12:00:00.000Z'), endMs: t('2026-01-01T13:00:00.000Z') }],
    );
    expect(free).toEqual([
      { startMs: t('2026-01-01T09:00:00.000Z'), endMs: t('2026-01-01T12:00:00.000Z') },
      { startMs: t('2026-01-01T13:00:00.000Z'), endMs: t('2026-01-01T17:00:00.000Z') },
    ]);
  });

  it('generateSlotsFromInterval uses stepMinutes not grid alignment', () => {
    const slots = generateSlotsFromInterval(
      { startMs: t('2026-01-01T09:07:00.000Z'), endMs: t('2026-01-01T09:22:00.000Z') },
      10,
      5,
    );
    expect(slots.length).toBe(2);
    expect(slots[0]!.start.toISOString()).toBe('2026-01-01T09:07:00.000Z');
    expect(slots[0]!.end.toISOString()).toBe('2026-01-01T09:17:00.000Z');
  });

  it('computeAvailability pipelines subtract then slots', () => {
    const day = '2026-01-01';
    const slots = computeAvailability({
      workingHours: [{ start: new Date(`${day}T09:00:00.000Z`), end: new Date(`${day}T12:00:00.000Z`) }],
      breaks: [{ start: new Date(`${day}T10:00:00.000Z`), end: new Date(`${day}T10:30:00.000Z`) }],
      bookings: [],
      serviceDurationMinutes: 30,
      stepMinutes: 15,
    });
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      '2026-01-01T09:00:00.000Z',
      '2026-01-01T09:15:00.000Z',
      '2026-01-01T09:30:00.000Z',
      '2026-01-01T10:30:00.000Z',
      '2026-01-01T10:45:00.000Z',
      '2026-01-01T11:00:00.000Z',
      '2026-01-01T11:15:00.000Z',
      '2026-01-01T11:30:00.000Z',
    ]);
  });
});
