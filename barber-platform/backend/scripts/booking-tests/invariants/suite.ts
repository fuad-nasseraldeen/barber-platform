import type { PrismaClient } from '@prisma/client';
import type { InvariantSuiteResult, InvariantViolation } from './types';
import {
  checkAppointmentOverlaps,
  checkSlotHoldOverlaps,
  checkAppointmentVsHoldOverlaps,
} from './db-interval-checks';
import { checkAvailabilityVsDb } from './availability-vs-db';

export interface RunSuiteOpts {
  prisma: PrismaClient;
  businessId?: string;
  /** Skip HTTP-based availability vs DB check (faster, DB-only). */
  skipAvailabilityHttp?: boolean;
  /** Required when skipAvailabilityHttp is false. */
  httpOpts?: {
    baseUrl: string;
    apiPrefix: string;
    authToken: string;
    staffId: string;
    serviceId: string;
    dateYmd: string;
    blockMinutes: number;
    businessTimezone: string;
  };
}

export async function runInvariantSuite(
  opts: RunSuiteOpts,
): Promise<InvariantSuiteResult> {
  const violations: InvariantViolation[] = [];

  const [apptOverlaps, holdOverlaps, crossOverlaps] = await Promise.all([
    checkAppointmentOverlaps(opts.prisma, opts.businessId),
    checkSlotHoldOverlaps(opts.prisma, opts.businessId),
    checkAppointmentVsHoldOverlaps(opts.prisma, opts.businessId),
  ]);

  violations.push(...apptOverlaps, ...holdOverlaps, ...crossOverlaps);

  if (!opts.skipAvailabilityHttp && opts.httpOpts && opts.businessId) {
    const avViolations = await checkAvailabilityVsDb({
      prisma: opts.prisma,
      baseUrl: opts.httpOpts.baseUrl,
      apiPrefix: opts.httpOpts.apiPrefix,
      authToken: opts.httpOpts.authToken,
      businessId: opts.businessId,
      staffId: opts.httpOpts.staffId,
      serviceId: opts.httpOpts.serviceId,
      dateYmd: opts.httpOpts.dateYmd,
      blockMinutes: opts.httpOpts.blockMinutes,
      businessTimezone: opts.httpOpts.businessTimezone,
    });
    violations.push(...avViolations);
  }

  return {
    ok: violations.filter((v) => v.severity === 'error').length === 0,
    violations,
    checkedAt: new Date().toISOString(),
    businessId: opts.businessId,
  };
}
