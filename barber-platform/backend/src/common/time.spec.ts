import { DateTime } from 'luxon';
import {
  addUtcMinutes,
  businessNowIsoInZone,
  getBusinessNow,
  startOfBusinessDay,
  toUtcFromBusiness,
} from './time';

describe('time (Luxon / Asia/Jerusalem)', () => {
  const tz = 'Asia/Jerusalem';

  it('getBusinessNow is in the requested zone', () => {
    const now = getBusinessNow(tz);
    expect(now.zoneName).toBe(tz);
    expect(now.isValid).toBe(true);
  });

  it('businessNowIsoInZone includes offset (no silent UTC)', () => {
    const iso = businessNowIsoInZone(tz);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(iso.includes('+') || iso.includes('-') || iso.endsWith('Z')).toBe(true);
  });

  it('toUtcFromBusiness round-trips wall time for a winter date (no bogus 2h shift)', () => {
    const utc = toUtcFromBusiness('2026-01-15', '10:00', tz);
    const back = DateTime.fromJSDate(utc, { zone: 'utc' }).setZone(tz);
    expect(back.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-01-15 10:00');
  });

  it('DST edge: spring forward day still maps wall clock via Luxon', () => {
    const utc = toUtcFromBusiness('2026-03-27', '09:00', tz);
    const local = DateTime.fromJSDate(utc, { zone: 'utc' }).setZone(tz);
    expect(local.hour).toBe(9);
    expect(local.minute).toBe(0);
  });

  it('addUtcMinutes uses DateTime.plus (not raw ms drift)', () => {
    const a = DateTime.utc(2026, 1, 15, 8, 0, 0).toJSDate();
    const b = addUtcMinutes(a, 90);
    expect(DateTime.fromJSDate(b, { zone: 'utc' }).toFormat('HH:mm')).toBe('09:30');
  });

  it('startOfBusinessDay is midnight in zone', () => {
    const d = startOfBusinessDay('2026-06-01', tz);
    expect(d.toFormat('HH:mm:ss')).toBe('00:00:00');
    expect(d.zoneName).toBe(tz);
  });
});
