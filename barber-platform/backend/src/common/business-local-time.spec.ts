import {
  businessLocalYmdHhmmToUtcDate,
  isBookableBlockWithinWorkingWindow,
  isSlotBlockInsideFreeSegments,
  isSlotBlockWithinWorkingMinutes,
  resolveStaffWorkingHoursForBusinessLocalDay,
  utcToBusinessLocalMinutesSinceDayStart,
  utcToBusinessLocalYmd,
  wallHhmmStringToMinuteOfDay,
} from './business-local-time';

describe('business-local-time / working minutes', () => {
  it('wallHhmmStringToMinuteOfDay matches hh semantics', () => {
    expect(wallHhmmStringToMinuteOfDay('09:00')).toBe(540);
    expect(wallHhmmStringToMinuteOfDay('18:00')).toBe(1080);
    expect(wallHhmmStringToMinuteOfDay(' 09:00:00 ')).toBe(540);
  });

  it('WH 09:00–18:00, duration 50: 09:00, 10:00, 17:10 valid; 17:20 invalid (numeric only)', () => {
    const whS = wallHhmmStringToMinuteOfDay('09:00');
    const whE = wallHhmmStringToMinuteOfDay('18:00');
    const dur = 50;
    expect(isSlotBlockWithinWorkingMinutes(540, dur, whS, whE)).toBe(true);
    expect(isSlotBlockWithinWorkingMinutes(600, dur, whS, whE)).toBe(true);
    expect(isSlotBlockWithinWorkingMinutes(1030, dur, whS, whE)).toBe(true);
    expect(isSlotBlockWithinWorkingMinutes(1040, dur, whS, whE)).toBe(false);
    expect(isSlotBlockWithinWorkingMinutes(539, dur, whS, whE)).toBe(false);
    expect(isBookableBlockWithinWorkingWindow(540, 590, whS, whE)).toBe(true);
    expect(isBookableBlockWithinWorkingWindow(1030, 1080, whS, whE)).toBe(true);
    expect(isBookableBlockWithinWorkingWindow(1040, 1090, whS, whE)).toBe(false);
    const free = [{ start: whS, end: whE }];
    expect(isSlotBlockInsideFreeSegments(540, 590, free)).toBe(true);
    expect(isSlotBlockInsideFreeSegments(1030, 1080, free)).toBe(true);
    expect(isSlotBlockInsideFreeSegments(1040, 1090, free)).toBe(false);
  });

  it('utcToBusinessLocalMinutesSinceDayStart uses Luxon day start (Asia/Jerusalem)', () => {
    const tz = 'Asia/Jerusalem';
    const ymd = '2026-06-15';
    const t540 = businessLocalYmdHhmmToUtcDate(tz, ymd, '09:00');
    expect(utcToBusinessLocalMinutesSinceDayStart(t540, tz, ymd)).toBe(540);
    expect(utcToBusinessLocalYmd(t540, tz)).toBe(ymd);
  });

  describe('resolveStaffWorkingHoursForBusinessLocalDay', () => {
    const tz = 'Asia/Jerusalem';
    it('returns []-equivalent null when weekly has no row for DOW', () => {
      const ymd = '2026-06-21'; // Sunday
      expect(
        resolveStaffWorkingHoursForBusinessLocalDay({
          ymd,
          timeZone: tz,
          weeklyRows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }],
          dateOverrides: [],
        }),
      ).toBeNull();
    });

    it('uses weekly hours when no override', () => {
      const ymd = '2026-06-22'; // Monday
      expect(
        resolveStaffWorkingHoursForBusinessLocalDay({
          ymd,
          timeZone: tz,
          weeklyRows: [{ dayOfWeek: 1, startTime: '10:00', endTime: '18:00' }],
          dateOverrides: [],
        }),
      ).toEqual({ startTime: '10:00', endTime: '18:00' });
    });

    it('override isClosed wins over weekly', () => {
      const ymd = '2026-06-22';
      const date = new Date(`${ymd}T00:00:00.000Z`);
      expect(
        resolveStaffWorkingHoursForBusinessLocalDay({
          ymd,
          timeZone: tz,
          weeklyRows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }],
          dateOverrides: [{ date, isClosed: true, startTime: null, endTime: null }],
        }),
      ).toBeNull();
    });

    it('override with valid window wins over weekly', () => {
      const ymd = '2026-06-22';
      const date = new Date(`${ymd}T00:00:00.000Z`);
      expect(
        resolveStaffWorkingHoursForBusinessLocalDay({
          ymd,
          timeZone: tz,
          weeklyRows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }],
          dateOverrides: [{ date, isClosed: false, startTime: '12:00', endTime: '20:00' }],
        }),
      ).toEqual({ startTime: '12:00', endTime: '20:00' });
    });

    it('invalid weekly window yields null', () => {
      const ymd = '2026-06-22';
      expect(
        resolveStaffWorkingHoursForBusinessLocalDay({
          ymd,
          timeZone: tz,
          weeklyRows: [{ dayOfWeek: 1, startTime: '17:00', endTime: '09:00' }],
          dateOverrides: [],
        }),
      ).toBeNull();
    });
  });
});
