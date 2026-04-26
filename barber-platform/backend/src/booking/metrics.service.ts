import { Injectable } from '@nestjs/common';

/** SLO-style targets for on-call / dashboards (not enforced in code). */
export const ACCEPTABLE_MONITORING_RATES = {
  /** availability_inconsistency: hold 409 after GET/assert showed slot — target max ~2%. */
  availabilityInconsistencyRateMax: 0.02,
  /** confirm/book double-book or exclusion — target max ~1%. */
  bookingConflictRateMax: 0.01,
} as const;

export interface BookingMetrics {
  bookingAttemptCount: number;
  bookingSuccessCount: number;
  bookingConflictCount: number;
  transactionRetryCount: number;
  lockAcquireCount: number;
  lockAcquireFailureCount: number;
  /** POST slot-holds after assert passed (denominator for inconsistency rate). */
  slotHoldAttemptAfterAssertCount: number;
  /** POST slot-holds that returned 409 after assert (stale read, race, or EXCLUDE). */
  slotHoldConflictAfterAssertCount: number;
}

/** Per-tenant counters. lockAcquireFailureCount ≈ fast 409 conflicts on lock. In production, use Prometheus/DataDog. */
const tenantMetrics = new Map<string, BookingMetrics>();

function getOrCreate(tenantId: string): BookingMetrics {
  let m = tenantMetrics.get(tenantId);
  if (!m) {
    m = {
      bookingAttemptCount: 0,
      bookingSuccessCount: 0,
      bookingConflictCount: 0,
      transactionRetryCount: 0,
      lockAcquireCount: 0,
      lockAcquireFailureCount: 0,
      slotHoldAttemptAfterAssertCount: 0,
      slotHoldConflictAfterAssertCount: 0,
    };
    tenantMetrics.set(tenantId, m);
  }
  return m;
}

@Injectable()
export class BookingMetricsService {
  incrementBookingAttempt(tenantId: string): void {
    getOrCreate(tenantId).bookingAttemptCount++;
  }

  incrementBookingSuccess(tenantId: string): void {
    getOrCreate(tenantId).bookingSuccessCount++;
  }

  incrementBookingConflict(tenantId: string): void {
    getOrCreate(tenantId).bookingConflictCount++;
  }

  incrementTransactionRetry(tenantId: string): void {
    getOrCreate(tenantId).transactionRetryCount++;
  }

  incrementLockAcquire(tenantId: string, success: boolean): void {
    const m = getOrCreate(tenantId);
    m.lockAcquireCount++;
    if (!success) m.lockAcquireFailureCount++;
  }

  incrementSlotHoldAttemptAfterAssert(tenantId: string): void {
    getOrCreate(tenantId).slotHoldAttemptAfterAssertCount++;
  }

  incrementSlotHoldConflictAfterAssert(tenantId: string): void {
    getOrCreate(tenantId).slotHoldConflictAfterAssertCount++;
  }

  getMetrics(
    tenantId?: string,
  ): Record<
    string,
    BookingMetrics & {
      availabilityInconsistencyRate: number;
      bookingConflictRate: number;
    }
  > {
    const wrap = (v: BookingMetrics) => {
      const attempts = v.bookingAttemptCount || 0;
      const holdA = v.slotHoldAttemptAfterAssertCount ?? 0;
      const holdC = v.slotHoldConflictAfterAssertCount ?? 0;
      return {
        ...v,
        slotHoldAttemptAfterAssertCount: holdA,
        slotHoldConflictAfterAssertCount: holdC,
        bookingConflictRate:
          attempts > 0 ? v.bookingConflictCount / attempts : 0,
        availabilityInconsistencyRate: holdA > 0 ? holdC / holdA : 0,
      };
    };
    if (tenantId) {
      const m = tenantMetrics.get(tenantId);
      return m ? { [tenantId]: wrap(m) } : {};
    }
    return Object.fromEntries(
      Array.from(tenantMetrics.entries()).map(([k, v]) => [k, wrap(v)]),
    );
  }
}
