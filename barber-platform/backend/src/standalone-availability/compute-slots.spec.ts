import {
  computeSlots,
  minutesToHhmm,
  overlaps,
  slotsToHhmm,
  type Booking,
  type Input,
} from './compute-slots';

describe('computeSlots (standalone)', () => {
  const wh: Pick<Input, 'workingStart' | 'workingEnd'> = {
    workingStart: 540, // 09:00
    workingEnd: 1080, // 18:00
  };

  it('Case 1: no bookings → grid of valid starts across full working window', () => {
    const input: Input = {
      ...wh,
      bookings: [],
      duration: 50,
      step: 5,
    };
    const slots = computeSlots(input);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]).toBe(540);
    expect(slots[slots.length - 1]).toBe(1030);
    expect(slots.every((s) => s % 5 === 0)).toBe(true);
  });

  it('Case 2: one booking 10:45–11:15, duration 50 → 10:40 (640) is NOT returned', () => {
    const booking: Booking = { start: 645, end: 675 }; // 10:45–11:15
    const input: Input = {
      ...wh,
      bookings: [booking],
      duration: 50,
      step: 5,
    };
    const slots = computeSlots(input);
    expect(slots).not.toContain(640);
    const slot640: Booking = { start: 640, end: 690 };
    expect(overlaps(slot640, booking)).toBe(true);
  });

  it('Case 3: booking ends exactly at slot start → slot allowed (touching boundary)', () => {
    const booking: Booking = { start: 600, end: 640 }; // ends 10:40
    const input: Input = {
      workingStart: 540,
      workingEnd: 700,
      bookings: [booking],
      duration: 30,
      step: 5,
    };
    const slots = computeSlots(input);
    expect(slots).toContain(640);
    const slot640: Booking = { start: 640, end: 670 };
    expect(overlaps(slot640, booking)).toBe(false);
  });
});

describe('readable HH:mm demo output', () => {
  it('prints examples to console', () => {
    const input: Input = {
      workingStart: 540,
      workingEnd: 1080,
      bookings: [{ start: 645, end: 675 }],
      duration: 50,
      step: 5,
    };
    const slots = computeSlots(input);
    const before = slots.filter((s) => s < 645).slice(-4);
    const after = slots.filter((s) => s >= 675).slice(0, 6);
    // eslint-disable-next-line no-console -- intentional demo
    console.log('\n[standalone-availability] Case 2 — booking 10:45–11:15, duration 50, step 5:\n');
    // eslint-disable-next-line no-console
    console.log('  640 (10:40) in output?', slots.includes(640), '(expected false)');
    // eslint-disable-next-line no-console
    console.log('  last starts before booking:', slotsToHhmm(before).join(', '));
    // eslint-disable-next-line no-console
    console.log('  first starts after booking: ', slotsToHhmm(after).join(', '));
    // eslint-disable-next-line no-console
    console.log('  total valid starts:', slots.length);
    expect(slots.includes(640)).toBe(false);
    expect(after.length).toBeGreaterThan(0);
  });
});
