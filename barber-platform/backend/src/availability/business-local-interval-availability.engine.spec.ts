import { businessLocalDayBounds } from '../common/business-local-time';
import {
  buildWorkingIntervalFromHhmm,
  computeSlotStartsFromWorkingAndBusy,
  generateSlotStartsFromFreeIntervals,
  mergeBusyIntervals,
  subtractBusyFromWorkingWindow,
  utcSpanToLocalDayBusyInterval,
  wallHhmmToMinuteOfDay,
} from './business-local-interval-availability.engine';

describe('business-local-interval-availability.engine', () => {
  it('normalizes HH:mm to integer minutes (09:00 → 540, 18:00 → 1080)', () => {
    expect(wallHhmmToMinuteOfDay('09:00')).toBe(540);
    expect(wallHhmmToMinuteOfDay('18:00')).toBe(1080);
    const wh = buildWorkingIntervalFromHhmm('09:00', '18:00');
    expect(wh).toEqual({ start: 540, end: 1080 });
  });

  it('WH 09:00–18:00, duration 50, step 5: includes 09:00, 10:00, 17:10; excludes 17:20', () => {
    const { slotStartMinutes } = computeSlotStartsFromWorkingAndBusy(
      '09:00',
      '18:00',
      [],
      50,
      5,
    );
    expect(slotStartMinutes).toContain(540);
    expect(slotStartMinutes).toContain(600);
    expect(slotStartMinutes).toContain(1030);
    expect(slotStartMinutes).not.toContain(1040);
    for (const t of slotStartMinutes) {
      expect(t + 50).toBeLessThanOrEqual(1080);
    }
  });

  it('WH 09:00–18:00, duration 100, step 5: last start 16:20; 17:45 must not appear', () => {
    const { slotStartMinutes } = computeSlotStartsFromWorkingAndBusy(
      '09:00',
      '18:00',
      [],
      100,
      5,
    );
    expect(slotStartMinutes[slotStartMinutes.length - 1]).toBe(980);
    expect(slotStartMinutes).toContain(980);
    expect(slotStartMinutes).not.toContain(1065);
    for (const t of slotStartMinutes) {
      expect(t + 100).toBeLessThanOrEqual(1080);
    }
  });

  it('WH 09:00–18:00, duration 25, step 5: last start 17:35', () => {
    const { slotStartMinutes } = computeSlotStartsFromWorkingAndBusy(
      '09:00',
      '18:00',
      [],
      25,
      5,
    );
    expect(slotStartMinutes[slotStartMinutes.length - 1]).toBe(1055);
    expect(slotStartMinutes).toContain(1055);
    for (const t of slotStartMinutes) {
      expect(t + 25).toBeLessThanOrEqual(1080);
    }
  });

  it('WH 09:00–18:00, duration 55, step 5: last 17:05 (1025); 17:10 (1030) must not be generated', () => {
    const { slotStartMinutes } = computeSlotStartsFromWorkingAndBusy(
      '09:00',
      '18:00',
      [],
      55,
      5,
    );
    expect(slotStartMinutes[0]).toBe(540);
    expect(slotStartMinutes).toContain(540);
    expect(slotStartMinutes).toContain(1025);
    expect(slotStartMinutes[slotStartMinutes.length - 1]).toBe(1025);
    expect(slotStartMinutes).not.toContain(1030);
    expect(slotStartMinutes).not.toContain(1045);
    for (const t of slotStartMinutes) {
      expect(t).toBeGreaterThanOrEqual(540);
      expect(t + 55).toBeLessThanOrEqual(1080);
    }
  });

  it('subtractBusyFromWorkingWindow: busy removes time; slots only in remaining free fragments', () => {
    const working = buildWorkingIntervalFromHhmm('09:00', '18:00');
    const busy = mergeBusyIntervals([{ start: 540, end: 600 }]);
    const free = subtractBusyFromWorkingWindow(working, busy);
    expect(free.some((f) => f.start === 600 && f.end === 1080)).toBe(true);
    const starts = generateSlotStartsFromFreeIntervals(free, 55, 5);
    expect(starts[0]).toBeGreaterThanOrEqual(600);
    for (const t of starts) {
      expect(t + 55).toBeLessThanOrEqual(1080);
    }
  });

  it('UTC span converts to local day minutes (Asia/Jerusalem smoke)', () => {
    const ymd = '2026-06-15';
    const tz = 'Asia/Jerusalem';
    const { startMs } = businessLocalDayBounds(tz, ymd);
    const start = new Date(startMs + 10 * 60 * 1000);
    const end = new Date(startMs + 70 * 60 * 1000);
    const b = utcSpanToLocalDayBusyInterval(start, end, ymd, tz);
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThanOrEqual(0);
    expect(b!.end).toBeLessThanOrEqual(24 * 60);
  });
});
