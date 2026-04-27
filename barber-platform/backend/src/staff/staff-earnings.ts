import { PaymentStatus } from '@prisma/client';
import { DateTime } from 'luxon';

export type StaffSettlementModel =
  | 'boothRental'
  | 'percentage'
  | 'fixedPerTreatment';

export type StaffSettlementConfig = {
  model: StaffSettlementModel;
  boothRentalAmount: number;
  businessCutPercent: number;
  fixedAmountPerTreatment: number;
  allowNegativeBalance: boolean;
  advancesTotal: number;
  alreadyPaidTotal: number;
};

export type StaffEarningsAppointmentRow = {
  id: string;
  startTime: Date;
  status: string;
  confirmationStatus?: string | null;
  servicePrice: number;
  paymentStatus?: PaymentStatus | null;
  paymentAmount?: number | null;
  customer?: {
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  } | null;
  service?: {
    name?: string | null;
  } | null;
};

export type StaffEarningsComputationResult = {
  completedAppointmentsCount: number;
  totalRevenue: number;
  grossEarnings: number;
  advancesTotal: number;
  alreadyPaidTotal: number;
  remainingToPay: number;
  finalPayable: number;
  noShowCount: number;
  cancelledCount: number;
  confirmedNoShowCount: number;
  eligibleAppointments: Array<{
    id: string;
    startTime: string;
    status: string;
    service: { name: string; price: number };
    customer: { firstName: string | null; lastName: string | null; phone: string | null };
    payment: { amount: number | null; status: PaymentStatus | null };
    revenueUsed: number;
  }>;
};

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function paymentMakesAppointmentPayrollEligible(
  paymentStatus: PaymentStatus | null | undefined,
): boolean {
  // If payment is not tracked on the row, treat as eligible completed work (cash/manual flow).
  if (!paymentStatus) return true;
  // Payroll must never include refunded/cancelled/failed transactions.
  if (
    paymentStatus === PaymentStatus.REFUNDED ||
    paymentStatus === PaymentStatus.CANCELLED ||
    paymentStatus === PaymentStatus.FAILED
  ) {
    return false;
  }
  // For tracked payments, require successful collection for payroll.
  return paymentStatus === PaymentStatus.SUCCEEDED;
}

function revenueForEligibleAppointment(row: StaffEarningsAppointmentRow): number {
  if (row.paymentStatus === PaymentStatus.SUCCEEDED) {
    return Math.max(0, safeNumber(row.paymentAmount));
  }
  return Math.max(0, safeNumber(row.servicePrice));
}

export function computeGrossEarningsBySettlementModel(
  totalRevenue: number,
  completedAppointmentsCount: number,
  settlement: StaffSettlementConfig,
): number {
  const safeRevenue = Math.max(0, totalRevenue);
  const safeCompleted = Math.max(0, completedAppointmentsCount);

  if (settlement.model === 'boothRental') {
    return roundMoney(Math.max(0, settlement.boothRentalAmount));
  }
  if (settlement.model === 'fixedPerTreatment') {
    return roundMoney(
      safeRevenue - safeCompleted * Math.max(0, settlement.fixedAmountPerTreatment),
    );
  }
  const safeBusinessCut = Math.max(0, Math.min(100, settlement.businessCutPercent));
  return roundMoney(safeRevenue * ((100 - safeBusinessCut) / 100));
}

export function computeStaffEarningsForRange(params: {
  rows: StaffEarningsAppointmentRow[];
  confirmationTrackingEnabled: boolean;
  settlement: StaffSettlementConfig;
}): StaffEarningsComputationResult {
  const eligibleAppointments: StaffEarningsComputationResult['eligibleAppointments'] = [];
  let completedAppointmentsCount = 0;
  let totalRevenue = 0;
  let noShowCount = 0;
  let cancelledCount = 0;
  let confirmedNoShowCount = 0;

  for (const row of params.rows) {
    if (row.status === 'NO_SHOW') {
      noShowCount += 1;
      if (
        params.confirmationTrackingEnabled &&
        row.confirmationStatus === 'CONFIRMED'
      ) {
        confirmedNoShowCount += 1;
      }
      continue;
    }

    if (row.status === 'CANCELLED') {
      cancelledCount += 1;
      continue;
    }

    if (row.status !== 'COMPLETED') {
      continue;
    }

    if (!paymentMakesAppointmentPayrollEligible(row.paymentStatus)) {
      continue;
    }

    completedAppointmentsCount += 1;
    const revenueUsed = revenueForEligibleAppointment(row);
    totalRevenue += revenueUsed;
    eligibleAppointments.push({
      id: row.id,
      startTime: row.startTime.toISOString(),
      status: row.status,
      service: {
        name: row.service?.name ?? '',
        price: Math.max(0, safeNumber(row.servicePrice)),
      },
      customer: {
        firstName: row.customer?.firstName ?? null,
        lastName: row.customer?.lastName ?? null,
        phone: row.customer?.phone ?? null,
      },
      payment: {
        amount:
          row.paymentAmount != null && Number.isFinite(Number(row.paymentAmount))
            ? Number(row.paymentAmount)
            : null,
        status: row.paymentStatus ?? null,
      },
      revenueUsed: roundMoney(revenueUsed),
    });
  }

  const grossEarnings = computeGrossEarningsBySettlementModel(
    totalRevenue,
    completedAppointmentsCount,
    params.settlement,
  );
  const advancesTotal = roundMoney(Math.max(0, params.settlement.advancesTotal));
  const alreadyPaidTotal = roundMoney(Math.max(0, params.settlement.alreadyPaidTotal));
  const remainingToPay = roundMoney(grossEarnings - advancesTotal - alreadyPaidTotal);

  return {
    completedAppointmentsCount,
    totalRevenue: roundMoney(totalRevenue),
    grossEarnings,
    advancesTotal,
    alreadyPaidTotal,
    remainingToPay,
    finalPayable: remainingToPay,
    noShowCount,
    cancelledCount,
    confirmedNoShowCount,
    eligibleAppointments: eligibleAppointments.sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    ),
  };
}

export function buildPreviousPeriodRange(fromDateYmd: string, toDateYmd: string): {
  fromDate: string;
  toDate: string;
} {
  const from = DateTime.fromISO(fromDateYmd.slice(0, 10), { zone: 'utc' }).startOf(
    'day',
  );
  const to = DateTime.fromISO(toDateYmd.slice(0, 10), { zone: 'utc' }).startOf('day');
  const daySpan = Math.max(1, Math.floor(to.diff(from, 'days').days) + 1);
  const prevTo = from.minus({ days: 1 });
  const prevFrom = prevTo.minus({ days: daySpan - 1 });
  return {
    fromDate: prevFrom.toISODate() ?? fromDateYmd.slice(0, 10),
    toDate: prevTo.toISODate() ?? toDateYmd.slice(0, 10),
  };
}

export function percentDelta(current: number, previous: number): number | null {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
  if (p === 0) {
    if (c === 0) return 0;
    return null;
  }
  return Math.round((((c - p) / p) * 100) * 100) / 100;
}
