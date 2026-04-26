import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type StaffReadinessResult = {
  isValid: boolean;
  issues: string[];
};

export const STAFF_READINESS_ISSUES = {
  NO_WORKING_HOURS: 'NO_WORKING_HOURS',
  NO_BOOKABLE_SERVICES: 'NO_BOOKABLE_SERVICES',
} as const;

export type StaffHealthRow = { id: string; firstName: string; lastName: string };

export type BusinessAvailabilityHealth = {
  withoutWorkingHours: StaffHealthRow[];
  withoutServices: StaffHealthRow[];
  totals: {
    staffConsidered: number;
    valid: number;
    invalid: number;
  };
};

@Injectable()
export class StaffReadinessValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  async validateStaff(staffId: string): Promise<StaffReadinessResult> {
    const issues: string[] = [];

    const [hasWh, bookableSvc] = await Promise.all([
      this.prisma.staffWorkingHours.findFirst({
        where: { staffId },
        select: { id: true },
      }),
      this.prisma.staffService.findFirst({
        where: {
          staffId,
          allowBooking: true,
          service: { deletedAt: null },
        },
        select: { id: true },
      }),
    ]);

    if (!hasWh) issues.push(STAFF_READINESS_ISSUES.NO_WORKING_HOURS);
    if (!bookableSvc) issues.push(STAFF_READINESS_ISSUES.NO_BOOKABLE_SERVICES);

    return { isValid: issues.length === 0, issues };
  }

  /**
   * Batched health report for GET /availability/health (no N+1 per staff).
   */
  async getBusinessHealth(businessId: string): Promise<BusinessAvailabilityHealth> {
    const staffRows = await this.prisma.staff.findMany({
      where: { businessId, deletedAt: null, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });

    if (staffRows.length === 0) {
      return {
        withoutWorkingHours: [],
        withoutServices: [],
        totals: { staffConsidered: 0, valid: 0, invalid: 0 },
      };
    }

    const ids = staffRows.map((s) => s.id);

    const [whRows, serviceRows] = await Promise.all([
      this.prisma.staffWorkingHours.findMany({
        where: { staffId: { in: ids } },
        select: { staffId: true },
        distinct: ['staffId'],
      }),
      this.prisma.staffService.findMany({
        where: { staffId: { in: ids }, allowBooking: true },
        select: { staffId: true, service: { select: { deletedAt: true } } },
      }),
    ]);

    const withWorkingHours = new Set(whRows.map((r) => r.staffId));
    const withBookableService = new Set<string>();
    for (const ss of serviceRows) {
      if (ss.service?.deletedAt == null) {
        withBookableService.add(ss.staffId);
      }
    }

    const withoutWorkingHours: StaffHealthRow[] = [];
    const withoutServices: StaffHealthRow[] = [];
    let valid = 0;

    for (const s of staffRows) {
      const okWh = withWorkingHours.has(s.id);
      const okSvc = withBookableService.has(s.id);
      if (okWh && okSvc) {
        valid++;
      } else {
        if (!okWh) withoutWorkingHours.push(s);
        if (!okSvc) withoutServices.push(s);
      }
    }

    return {
      withoutWorkingHours,
      withoutServices,
      totals: {
        staffConsidered: staffRows.length,
        valid,
        invalid: staffRows.length - valid,
      },
    };
  }
}
