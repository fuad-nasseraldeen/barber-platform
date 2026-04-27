import { PaymentStatus } from '@prisma/client';
import {
  buildPreviousPeriodRange,
  computeStaffEarningsForRange,
  percentDelta,
  type StaffSettlementConfig,
} from './staff-earnings';

const settlement: StaffSettlementConfig = {
  model: 'percentage',
  boothRentalAmount: 0,
  businessCutPercent: 20,
  fixedAmountPerTreatment: 0,
  allowNegativeBalance: false,
  advancesTotal: 0,
  alreadyPaidTotal: 0,
};

describe('staff earnings computation', () => {
  it('scheduled appointment does not increase earnings', () => {
    const result = computeStaffEarningsForRange({
      rows: [
        {
          id: 'a1',
          startTime: new Date('2026-04-10T09:00:00.000Z'),
          status: 'CONFIRMED',
          servicePrice: 120,
        },
      ],
      confirmationTrackingEnabled: true,
      settlement,
    });
    expect(result.completedAppointmentsCount).toBe(0);
    expect(result.totalRevenue).toBe(0);
  });

  it('confirmed appointment does not increase earnings', () => {
    const result = computeStaffEarningsForRange({
      rows: [
        {
          id: 'a2',
          startTime: new Date('2026-04-10T10:00:00.000Z'),
          status: 'CONFIRMED',
          servicePrice: 100,
          confirmationStatus: 'CONFIRMED',
        },
      ],
      confirmationTrackingEnabled: true,
      settlement,
    });
    expect(result.completedAppointmentsCount).toBe(0);
    expect(result.totalRevenue).toBe(0);
  });

  it('no-show does not increase earnings', () => {
    const result = computeStaffEarningsForRange({
      rows: [
        {
          id: 'a3',
          startTime: new Date('2026-04-10T11:00:00.000Z'),
          status: 'NO_SHOW',
          servicePrice: 100,
        },
      ],
      confirmationTrackingEnabled: true,
      settlement,
    });
    expect(result.completedAppointmentsCount).toBe(0);
    expect(result.totalRevenue).toBe(0);
    expect(result.noShowCount).toBe(1);
  });

  it('completed + paid appointment increases earnings', () => {
    const result = computeStaffEarningsForRange({
      rows: [
        {
          id: 'a4',
          startTime: new Date('2026-04-10T12:00:00.000Z'),
          status: 'COMPLETED',
          servicePrice: 100,
          paymentStatus: PaymentStatus.SUCCEEDED,
          paymentAmount: 200,
        },
      ],
      confirmationTrackingEnabled: true,
      settlement,
    });
    expect(result.completedAppointmentsCount).toBe(1);
    expect(result.totalRevenue).toBe(200);
    expect(result.grossEarnings).toBe(160);
  });

  it('confirmation flag OFF ignores confirmation status metric', () => {
    const result = computeStaffEarningsForRange({
      rows: [
        {
          id: 'a5',
          startTime: new Date('2026-04-10T13:00:00.000Z'),
          status: 'NO_SHOW',
          servicePrice: 100,
          confirmationStatus: 'CONFIRMED',
        },
      ],
      confirmationTrackingEnabled: false,
      settlement,
    });
    expect(result.confirmedNoShowCount).toBe(0);
  });

  it('confirmation flag ON tracks confirmed no-show metric', () => {
    const result = computeStaffEarningsForRange({
      rows: [
        {
          id: 'a6',
          startTime: new Date('2026-04-10T14:00:00.000Z'),
          status: 'NO_SHOW',
          servicePrice: 100,
          confirmationStatus: 'CONFIRMED',
        },
        {
          id: 'a7',
          startTime: new Date('2026-04-10T15:00:00.000Z'),
          status: 'NO_SHOW',
          servicePrice: 100,
          confirmationStatus: 'PENDING',
        },
      ],
      confirmationTrackingEnabled: true,
      settlement,
    });
    expect(result.noShowCount).toBe(2);
    expect(result.confirmedNoShowCount).toBe(1);
  });

  it('refunded completed appointment does not increase earnings', () => {
    const result = computeStaffEarningsForRange({
      rows: [
        {
          id: 'a8',
          startTime: new Date('2026-04-10T16:00:00.000Z'),
          status: 'COMPLETED',
          servicePrice: 120,
          paymentStatus: PaymentStatus.REFUNDED,
          paymentAmount: 120,
        },
      ],
      confirmationTrackingEnabled: true,
      settlement,
    });
    expect(result.completedAppointmentsCount).toBe(0);
    expect(result.totalRevenue).toBe(0);
  });

  it('builds previous period for custom date range', () => {
    const prev = buildPreviousPeriodRange('2026-04-05', '2026-04-15');
    expect(prev).toEqual({
      fromDate: '2026-03-25',
      toDate: '2026-04-04',
    });
  });

  it('computes previous period comparison delta', () => {
    expect(percentDelta(1200, 1000)).toBe(20);
    expect(percentDelta(0, 0)).toBe(0);
    expect(percentDelta(100, 0)).toBeNull();
  });
});
