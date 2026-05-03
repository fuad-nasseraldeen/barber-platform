import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService, CACHE_TTL } from '../redis/cache.service';
import { ComputedAvailabilityService } from '../availability/computed-availability.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { RegisterStaffDto } from './dto/register-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffServicesDto } from './dto/staff-services.dto';
import { StaffWorkingHoursDto } from './dto/staff-working-hours.dto';
import { StaffWorkingHoursBatchDto } from './dto/staff-working-hours-batch.dto';
import { StaffBreakDto, StaffWeeklyBreakMeDto } from './dto/staff-break.dto';
import {
  CreateStaffBreakExceptionDto,
  CreateStaffBreakExceptionBulkDto,
  CreateStaffBreakExceptionMeDto,
  CreateStaffBreakExceptionBulkMeDto,
} from './dto/staff-break-exception.dto';
import {
  StaffBreakBulkWeeklyDto,
  StaffBreakBulkWeeklyRangeDto,
} from './dto/staff-break-bulk-weekly.dto';
import { StaffTimeOffDto } from './dto/staff-time-off.dto';
import { UpdateMyServicesDto } from './dto/update-my-services.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { RequestVacationDto } from './dto/request-vacation.dto';
import { PaymentStatus, VacationStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import {
  addBusinessDaysFromYmd,
  businessLocalDayBounds,
  businessLocalYmdFromJsDate,
  resolveBusinessTimeZone,
} from '../common/business-local-time';
import { endDateOnlyUtcInclusive, parseDateOnlyUtc } from '../common/date-only';
import { TimeSlotProjectionLifecycleService } from '../availability/time-slot-projection-lifecycle.service';
import {
  buildPreviousPeriodRange,
  computeStaffEarningsForRange,
  percentDelta,
  type StaffSettlementConfig,
} from './staff-earnings';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
    private readonly computed: ComputedAvailabilityService,
    private readonly timeSlotProjectionLifecycle: TimeSlotProjectionLifecycleService,
  ) {}

  async registerFromInvite(userId: string, dto: RegisterStaffDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.phone) {
      throw new BadRequestException('User or phone not found');
    }

    const staffInvite = await this.prisma.staffInvite.findFirst({
      where: {
        phone: user.phone,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      include: { business: true, role: true },
    });

    if (!staffInvite) {
      throw new BadRequestException('No pending staff invite found for this phone');
    }

    const existingStaff = await this.prisma.staff.findFirst({
      where: { userId, businessId: staffInvite.businessId, deletedAt: null },
    });
    if (existingStaff) {
      throw new BadRequestException('Already registered as staff');
    }

    let branchId = staffInvite.branchId;
    if (!branchId) {
      const firstBranch = await this.prisma.branch.findFirst({
        where: { businessId: staffInvite.businessId },
        select: { id: true },
      });
      if (!firstBranch) throw new BadRequestException('Business has no branches');
      branchId = firstBranch.id;
    }
    const staff = await this.prisma.staff.create({
      data: {
        businessId: staffInvite.businessId,
        branchId,
        userId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: user.phone,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        gender: dto.gender ?? null,
      },
      include: { branch: true },
    });

    await this.seedDefaultWorkingHours(staff.id, staff.branchId);

    await this.prisma.businessUser.create({
      data: {
        businessId: staffInvite.businessId,
        userId,
        roleId: staffInvite.roleId,
        invitedAt: new Date(),
      },
    });

    await this.prisma.staffInvite.update({
      where: { id: staffInvite.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), staffId: staff.id },
    });

    await this.cache.invalidateBusiness(staffInvite.businessId);
    return staff;
  }

  async create(businessId: string, dto: CreateStaffDto) {
    const staff = await this.prisma.staff.create({
      data: {
        businessId,
        branchId: dto.branchId,
        locationId: dto.locationId,
        userId: dto.userId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        gender: dto.gender ?? null,
        avatarUrl: dto.avatarUrl,
        title: dto.title,
        bio: dto.bio,
        instagram: dto.instagram,
        facebook: dto.facebook,
        whatsapp: dto.whatsapp,
      },
      include: {
        branch: true,
        location: true,
      },
    });
    await this.seedDefaultWorkingHours(staff.id, staff.branchId);
    await this.cache.invalidateBusiness(businessId);
    return staff;
  }

  async findAll(
    businessId: string,
    includeInactive = false,
    branchId?: string,
    excludeManagers = false,
    page?: number,
    limit?: number,
  ) {
    const usePagination = page != null && limit != null;
    const cacheKey = CacheService.keys.staffList(businessId, branchId, excludeManagers);
    const useCache = !includeInactive && !usePagination;
    if (useCache) {
      const cached = await this.cache.get<Awaited<ReturnType<typeof this.fetchStaffList>>>(cacheKey);
      if (cached) return cached;
    }
    const list = await this.fetchStaffList(
      businessId,
      includeInactive,
      branchId,
      excludeManagers,
      page,
      limit,
    );
    if (useCache) {
      await this.cache.set(cacheKey, list, CACHE_TTL.STAFF_LIST);
    }
    return list;
  }

  private async fetchStaffList(
    businessId: string,
    includeInactive: boolean,
    branchId?: string,
    excludeManagers = false,
    page?: number,
    limit?: number,
  ) {
    const where: {
      businessId: string;
      deletedAt: null;
      isActive?: boolean;
      branchId?: string;
      OR?: Array<{ userId: null } | { userId: { notIn: string[] } }>;
    } = {
      businessId,
      deletedAt: null,
    };
    if (!includeInactive) where.isActive = true;
    if (branchId) where.branchId = branchId;
    if (excludeManagers) {
      const managerUserIds = await this.prisma.businessUser.findMany({
        where: {
          businessId,
          role: { slug: { in: ['owner', 'manager'] } },
        },
        select: { userId: true },
      });
      const ids = managerUserIds.map((u) => u.userId).filter(Boolean);
      if (ids.length > 0) {
        where.OR = [{ userId: null }, { userId: { notIn: ids } }];
      }
    }
    const skip = page != null && limit != null ? (page - 1) * limit : undefined;
    const take = limit;
    const list = await this.prisma.staff.findMany({
      where,
      include: {
        branch: true,
        location: true,
        staffServices: { include: { service: true } },
        staffWorkingHours: true,
        staffBreaks: true,
        staffTimeOff: {
          where: { status: 'APPROVED' },
          orderBy: { startDate: 'asc' },
        },
        user: {
          select: {
            avatarUrl: true,
            businessUsers: {
              where: { businessId },
              take: 1,
              select: { role: { select: { slug: true } } },
            },
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip,
      take: limit,
    });
    const managementRank = (slug: string | null) => {
      if (slug === 'owner') return 0;
      if (slug === 'manager') return 1;
      return 2;
    };
    const mapped = list.map(({ user, ...s }) => {
      const businessRoleSlug = user?.businessUsers?.[0]?.role?.slug ?? null;
      return {
        ...s,
        avatarUrl: s.avatarUrl ?? user?.avatarUrl ?? null,
        businessRoleSlug,
      };
    });
    mapped.sort((a, b) => {
      const ra = managementRank(a.businessRoleSlug ?? null);
      const rb = managementRank(b.businessRoleSlug ?? null);
      if (ra !== rb) return ra - rb;
      const ln = (a.lastName || '').localeCompare(b.lastName || '', undefined, { sensitivity: 'base' });
      if (ln !== 0) return ln;
      return (a.firstName || '').localeCompare(b.firstName || '', undefined, { sensitivity: 'base' });
    });
    return mapped;
  }

  async findById(id: string, viewerBusinessId?: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id, deletedAt: null },
      include: {
        branch: true,
        location: true,
        staffServices: { include: { service: true } },
        staffWorkingHours: true,
        staffBreaks: true,
        staffTimeOff: true,
      },
    });
    if (!staff) {
      throw new NotFoundException('Staff not found');
    }
    if (viewerBusinessId && staff.businessId !== viewerBusinessId) {
      throw new ForbiddenException('Staff does not belong to this business');
    }
    return staff;
  }

  async getStaffEarningsSummary(params: {
    businessId: string;
    staffId: string;
    fromDate: string;
    toDate: string;
    compareWithPreviousPeriod?: boolean;
  }) {
    await this.ensureStaffBelongsToBusiness(params.staffId, params.businessId);

    const fromDateUtc = parseDateOnlyUtc(params.fromDate.slice(0, 10));
    const toDateUtc = endDateOnlyUtcInclusive(params.toDate.slice(0, 10));
    if (toDateUtc.getTime() < fromDateUtc.getTime()) {
      throw new BadRequestException('toDate must be after fromDate');
    }

    const business = await this.prisma.business.findUnique({
      where: { id: params.businessId },
      select: { settings: true },
    });
    const settings = (business?.settings ?? {}) as {
      generalSettings?: { requireCustomerArrivalConfirmation?: boolean };
      staffSettlement?: Record<string, Partial<StaffSettlementConfig>>;
    };
    const confirmationTrackingEnabled =
      settings.generalSettings?.requireCustomerArrivalConfirmation === true;
    const settlement = this.resolveStaffSettlementConfig(
      settings.staffSettlement?.[params.staffId],
    );

    const rows = await this.prisma.appointment.findMany({
      where: {
        businessId: params.businessId,
        staffId: params.staffId,
        startTime: {
          gte: fromDateUtc,
          lte: toDateUtc,
        },
      },
      include: {
        payment: { select: { amount: true, status: true } },
        service: { select: { name: true, price: true } },
        customer: { select: { firstName: true, lastName: true, phone: true } },
      },
      orderBy: { startTime: 'asc' },
    });

    const current = computeStaffEarningsForRange({
      rows: rows.map((row) => ({
        id: row.id,
        startTime: row.startTime,
        status: row.status,
        confirmationStatus:
          (row as unknown as { confirmationStatus?: string | null })
            .confirmationStatus ?? null,
        servicePrice: Number(row.service.price),
        paymentStatus: row.payment?.status as PaymentStatus | null | undefined,
        paymentAmount:
          row.payment?.amount != null ? Number(row.payment.amount) : null,
        customer: row.customer,
        service: row.service,
      })),
      confirmationTrackingEnabled,
      settlement,
    });

    let previousPeriodComparison:
      | {
          fromDate: string;
          toDate: string;
          completedAppointmentsCount: number;
          totalRevenue: number;
          grossEarnings: number;
          finalPayable: number;
          revenueDeltaPercent: number | null;
          completedDeltaPercent: number | null;
          payableDeltaPercent: number | null;
        }
      | undefined;

    if (params.compareWithPreviousPeriod) {
      const prevRange = buildPreviousPeriodRange(params.fromDate, params.toDate);
      const prevFrom = parseDateOnlyUtc(prevRange.fromDate);
      const prevToInclusive = endDateOnlyUtcInclusive(prevRange.toDate);

      const previousRows = await this.prisma.appointment.findMany({
        where: {
          businessId: params.businessId,
          staffId: params.staffId,
          startTime: {
            gte: prevFrom,
            lte: prevToInclusive,
          },
        },
        include: {
          payment: { select: { amount: true, status: true } },
          service: { select: { name: true, price: true } },
          customer: { select: { firstName: true, lastName: true, phone: true } },
        },
        orderBy: { startTime: 'asc' },
      });

      const prev = computeStaffEarningsForRange({
        rows: previousRows.map((row) => ({
          id: row.id,
          startTime: row.startTime,
          status: row.status,
          confirmationStatus:
            (row as unknown as { confirmationStatus?: string | null })
              .confirmationStatus ?? null,
          servicePrice: Number(row.service.price),
          paymentStatus: row.payment?.status as PaymentStatus | null | undefined,
          paymentAmount:
            row.payment?.amount != null ? Number(row.payment.amount) : null,
          customer: row.customer,
          service: row.service,
        })),
        confirmationTrackingEnabled,
        settlement,
      });

      previousPeriodComparison = {
        fromDate: prevRange.fromDate,
        toDate: prevRange.toDate,
        completedAppointmentsCount: prev.completedAppointmentsCount,
        totalRevenue: prev.totalRevenue,
        grossEarnings: prev.grossEarnings,
        finalPayable: prev.finalPayable,
        revenueDeltaPercent: percentDelta(current.totalRevenue, prev.totalRevenue),
        completedDeltaPercent: percentDelta(
          current.completedAppointmentsCount,
          prev.completedAppointmentsCount,
        ),
        payableDeltaPercent: percentDelta(
          current.finalPayable,
          prev.finalPayable,
        ),
      };
    }

    return {
      staffId: params.staffId,
      fromDate: params.fromDate.slice(0, 10),
      toDate: params.toDate.slice(0, 10),
      settlementModel: settlement.model,
      completedAppointmentsCount: current.completedAppointmentsCount,
      totalRevenue: current.totalRevenue,
      grossEarnings: current.grossEarnings,
      advancesTotal: current.advancesTotal,
      alreadyPaidTotal: current.alreadyPaidTotal,
      remainingToPay: current.remainingToPay,
      finalPayable: current.finalPayable,
      noShowCount: current.noShowCount,
      cancelledCount: current.cancelledCount,
      confirmedNoShowCount: current.confirmedNoShowCount,
      confirmationTrackingEnabled,
      previousPeriodComparison,
      eligibleAppointments: current.eligibleAppointments,
      settlementConfig: {
        model: settlement.model,
        boothRentalAmount: settlement.boothRentalAmount,
        businessCutPercent: settlement.businessCutPercent,
        fixedAmountPerTreatment: settlement.fixedAmountPerTreatment,
        allowNegativeBalance: settlement.allowNegativeBalance,
      },
    };
  }

  private resolveStaffSettlementConfig(
    raw: Partial<StaffSettlementConfig> | undefined,
  ): StaffSettlementConfig {
    const model =
      raw?.model === 'boothRental' ||
      raw?.model === 'fixedPerTreatment' ||
      raw?.model === 'percentage'
        ? raw.model
        : 'percentage';

    const toNonNegative = (value: unknown, fallback: number): number => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, n);
    };

    return {
      model,
      boothRentalAmount: toNonNegative(raw?.boothRentalAmount, 0),
      businessCutPercent: Math.min(
        100,
        toNonNegative(raw?.businessCutPercent, 20),
      ),
      fixedAmountPerTreatment: toNonNegative(raw?.fixedAmountPerTreatment, 0),
      allowNegativeBalance: raw?.allowNegativeBalance === true,
      advancesTotal: toNonNegative(raw?.advancesTotal, 0),
      alreadyPaidTotal: toNonNegative(raw?.alreadyPaidTotal, 0),
    };
  }

  async update(id: string, businessId: string, dto: UpdateStaffDto) {
    await this.ensureStaffBelongsToBusiness(id, businessId);
    await this.cache.invalidateBusiness(businessId);
    return this.prisma.staff.update({
      where: { id },
      data: {
        branchId: dto.branchId,
        locationId: dto.locationId,
        userId: dto.userId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        avatarUrl: dto.avatarUrl,
        title: dto.title,
        bio: dto.bio,
        isActive: dto.isActive,
        instagram: dto.instagram,
        facebook: dto.facebook,
        whatsapp: dto.whatsapp,
        ...(dto.monthlyTargetRevenue !== undefined && {
          monthlyTargetRevenue: dto.monthlyTargetRevenue,
        }),
        ...(dto.birthDate !== undefined && {
          birthDate: dto.birthDate != null && dto.birthDate !== '' ? new Date(dto.birthDate) : null,
        }),
        ...(dto.gender !== undefined && {
          gender: dto.gender === null || dto.gender === '' ? null : dto.gender,
        }),
      },
      include: { branch: true, location: true },
    });
  }

  async updateStaffServices(
    staffId: string,
    businessId: string,
    dto: {
      updates: Array<{
        staffServiceId: string;
        allowBooking?: boolean;
        durationMinutes?: number;
        price?: number;
      }>;
    },
  ) {
    await this.ensureStaffBelongsToBusiness(staffId, businessId);

    for (const u of dto.updates) {
      const ss = await this.prisma.staffService.findUnique({
        where: { id: u.staffServiceId },
        include: { staff: true },
      });
      if (!ss || ss.staffId !== staffId || ss.staff.businessId !== businessId) {
        throw new ForbiddenException('Cannot update this staff service');
      }
      await this.prisma.staffService.update({
        where: { id: u.staffServiceId },
        data: {
          ...(u.allowBooking !== undefined && { allowBooking: u.allowBooking }),
          ...(u.durationMinutes != null && { durationMinutes: u.durationMinutes }),
          ...(u.price != null && { price: u.price }),
        },
      });
    }

    await this.cache.invalidateBusiness(businessId);
    return this.findById(staffId);
  }

  private slugFromServiceName(name: string): string {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-\u0590-\u05FF]/g, '');
    if (base) return base;
    let h = 0;
    for (let i = 0; i < name.length; i++) {
      h = ((h << 5) - h + name.charCodeAt(i)) | 0;
    }
    return `s-${Math.abs(h).toString(36)}`;
  }

  private async ensureStaffCanAttachToCatalogService(staffId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, deletedAt: null },
      select: { blockAllStaff: true },
    });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    if (service.blockAllStaff) {
      throw new ForbiddenException('This service is not available for staff');
    }
    const block = await this.prisma.serviceStaffBlock.findUnique({
      where: {
        serviceId_staffId: { serviceId, staffId },
      },
    });
    if (block) {
      throw new ForbiddenException('This service is not available for you');
    }
  }

  async addStaffService(
    staffId: string,
    dto: { businessId: string; serviceId: string; durationMinutes?: number; price?: number },
  ) {
    await this.ensureStaffBelongsToBusiness(staffId, dto.businessId);
    await this.ensureStaffCanAttachToCatalogService(staffId, dto.serviceId);
    await this.ensureServiceBelongsToStaffBranch(staffId, dto.serviceId);

    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId, deletedAt: null },
    });
    if (!service) throw new NotFoundException('Service not found');

    const existing = await this.prisma.staffService.findUnique({
      where: { staffId_serviceId: { staffId, serviceId: dto.serviceId } },
    });
    if (existing) {
      throw new ConflictException('Staff already has this service');
    }

    await this.prisma.staffService.create({
      data: {
        staffId,
        serviceId: dto.serviceId,
        durationMinutes: dto.durationMinutes ?? service.durationMinutes,
        price: dto.price ?? service.price,
      },
    });

    await this.cache.invalidateStaffValidationBundleForStaff(
      staffId,
      'staff_service_added',
    );
    await this.cache.invalidateBusiness(dto.businessId);
    return this.findById(staffId);
  }

  async removeStaffService(staffId: string, staffServiceId: string, businessId: string) {
    await this.ensureStaffBelongsToBusiness(staffId, businessId);

    const ss = await this.prisma.staffService.findUnique({
      where: { id: staffServiceId },
      include: { staff: true },
    });
    if (!ss || ss.staffId !== staffId || ss.staff.businessId !== businessId) {
      throw new ForbiddenException('Cannot remove this staff service');
    }

    await this.prisma.staffService.delete({
      where: { id: staffServiceId },
    });

    await this.cache.invalidateStaffValidationBundleForStaff(
      staffId,
      'staff_service_removed',
    );
    await this.cache.invalidateBusiness(businessId);
    return this.findById(staffId);
  }

  private async ensureServiceBelongsToStaffBranch(staffId: string, serviceId: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { branchId: true },
    });
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: { branchId: true },
    });
    if (!staff || !service) return;
    if (!service.branchId) return;
    if (staff.branchId && staff.branchId !== service.branchId) {
      throw new ForbiddenException('Service must belong to the same branch as the staff');
    }
  }

  async updatePhoto(id: string, businessId: string, avatarUrl: string) {
    await this.ensureStaffBelongsToBusiness(id, businessId);
    await this.cache.invalidateBusiness(businessId);
    return this.prisma.staff.update({
      where: { id },
      data: { avatarUrl },
      include: { branch: true, location: true },
    });
  }

  async deactivate(id: string, businessId: string) {
    await this.ensureStaffBelongsToBusiness(id, businessId);
    return this.prisma.staff.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async delete(id: string, businessId: string) {
    await this.ensureStaffBelongsToBusiness(id, businessId);
    await this.cache.invalidateBusiness(businessId);
    await this.prisma.staff.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { success: true };
  }

  async findMyProfile(userId: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { userId, deletedAt: null },
      include: {
        branch: true,
        staffServices: { include: { service: true } },
        staffWorkingHours: true,
        staffBreaks: true,
        staffTimeOff: true,
        user: { select: { avatarUrl: true } },
      },
    });
    if (!staff) {
      throw new NotFoundException('Staff profile not found');
    }
    const { user, ...rest } = staff;
    return {
      ...rest,
      avatarUrl: staff.avatarUrl ?? user?.avatarUrl ?? null,
    };
  }

  async updateMyProfile(userId: string, dto: UpdateMyProfileDto) {
    const staff = await this.prisma.staff.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!staff) {
      throw new NotFoundException('Staff profile not found');
    }
    await this.cache.invalidateBusiness(staff.businessId);
    await this.prisma.staff.update({
      where: { id: staff.id },
      data: {
        ...(dto.firstName != null && { firstName: dto.firstName }),
        ...(dto.lastName != null && { lastName: dto.lastName }),
        ...(dto.phone !== undefined && { phone: dto.phone || null }),
      },
    });
    return this.findMyProfile(userId);
  }

  async updateMyPhoto(userId: string, avatarUrl: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!staff) {
      throw new NotFoundException('Staff profile not found');
    }
    await this.cache.invalidateBusiness(staff.businessId);
    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { avatarUrl },
    });
    return this.findMyProfile(userId);
  }

  async updateMyServices(userId: string, dto: UpdateMyServicesDto) {
    const staff = await this.prisma.staff.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!staff) {
      throw new NotFoundException('Staff profile not found');
    }

    for (const u of dto.updates) {
      const ss = await this.prisma.staffService.findUnique({
        where: { id: u.staffServiceId },
        include: { staff: true },
      });
      if (!ss || ss.staffId !== staff.id) {
        throw new ForbiddenException('Cannot update this staff service');
      }
      await this.prisma.staffService.update({
        where: { id: u.staffServiceId },
        data: {
          ...(u.allowBooking !== undefined && { allowBooking: u.allowBooking }),
          ...(u.durationMinutes != null && { durationMinutes: u.durationMinutes }),
          ...(u.price != null && { price: u.price }),
        },
      });
    }

    await this.cache.invalidateStaffValidationBundleForStaff(
      staff.id,
      'staff_service_metadata_updated',
    );
    await this.cache.invalidateBusiness(staff.businessId);
    return this.findMyProfile(userId);
  }

  async addServiceToMyself(
    userId: string,
    dto: {
      serviceId?: string;
      newServiceName?: string;
      durationMinutes: number;
      price: number;
      branchId?: string;
    },
  ) {
    const staff = await this.prisma.staff.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!staff) {
      throw new NotFoundException('Staff profile not found');
    }
    const newName = dto.newServiceName?.trim();
    if (newName && dto.serviceId) {
      throw new BadRequestException('Send either serviceId or newServiceName, not both');
    }
    if (!newName && !dto.serviceId) {
      throw new BadRequestException('serviceId or newServiceName is required');
    }
    if (newName) {
      return this.createPersonalCatalogService(userId, staff, newName, dto.durationMinutes, dto.price, dto.branchId);
    }
    await this.addStaffService(staff.id, {
      businessId: staff.businessId,
      serviceId: dto.serviceId!,
      durationMinutes: dto.durationMinutes,
      price: dto.price,
    });
    return this.findMyProfile(userId);
  }

  private async createPersonalCatalogService(
    userId: string,
    staff: { id: string; businessId: string; branchId: string | null },
    name: string,
    durationMinutes: number,
    price: number,
    branchIdInput?: string,
  ) {
    const branchId = branchIdInput ?? staff.branchId ?? null;
    const slug = this.slugFromServiceName(name);
    const existing = await this.prisma.service.findFirst({
      where: { businessId: staff.businessId, branchId, slug, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('A service with this name already exists');
    }
    const maxOrder = await this.prisma.service.aggregate({
      where: { businessId: staff.businessId, branchId, deletedAt: null },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxOrder._max?.sortOrder ?? -1) + 1;
    const created = await this.prisma.service.create({
      data: {
        businessId: staff.businessId,
        branchId,
        name,
        slug,
        durationMinutes,
        price,
        color: '#3B82F6',
        isActive: true,
        sortOrder,
      },
    });
    await this.prisma.staffService.create({
      data: {
        staffId: staff.id,
        serviceId: created.id,
        durationMinutes,
        price,
      },
    });
    await this.cache.invalidateStaffValidationBundleForStaff(
      staff.id,
      'personal_service_created',
    );
    await this.cache.invalidateBusiness(staff.businessId);
    return this.findMyProfile(userId);
  }

  async removeMyService(userId: string, staffServiceId: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!staff) {
      throw new NotFoundException('Staff profile not found');
    }
    await this.removeStaffService(staff.id, staffServiceId, staff.businessId);
    return this.findMyProfile(userId);
  }

  async assignServices(dto: StaffServicesDto) {
    await this.ensureStaffBelongsToBusiness(dto.staffId, dto.businessId);
    await this.ensureServicesBelongToBusiness(dto.serviceIds, dto.businessId);
    for (const serviceId of dto.serviceIds) {
      await this.ensureStaffCanAttachToCatalogService(dto.staffId, serviceId);
    }

    await this.prisma.staffService.deleteMany({
      where: { staffId: dto.staffId },
    });
    await this.prisma.staffService.createMany({
      data: dto.serviceIds.map((serviceId) => ({
        staffId: dto.staffId,
        serviceId,
      })),
    });
    await this.cache.invalidateStaffValidationBundleForStaff(
      dto.staffId,
      'staff_services_assigned',
    );
    return this.findById(dto.staffId);
  }

  async setWorkingHours(dto: StaffWorkingHoursDto) {
    await this.ensureStaffBelongsToBusiness(dto.staffId, dto.businessId);
    this.validateTimeRange(dto.startTime, dto.endTime);

    const staff = await this.prisma.staff.findUnique({
      where: { id: dto.staffId },
      select: { branchId: true },
    });
    const result = await this.prisma.staffWorkingHours.upsert({
      where: {
        staffId_dayOfWeek: { staffId: dto.staffId, dayOfWeek: dto.dayOfWeek },
      },
      create: {
        staffId: dto.staffId,
        branchId: staff?.branchId ?? undefined,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
      update: {
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });

    await this.cache.invalidateStaffValidationBundleForStaff(
      dto.staffId,
      'working_hours_updated',
    );
    await this.cache.invalidateBusiness(dto.businessId);
    return result;
  }

  /**
   * Replace the staff member's entire weekly working-hours row set in one transaction.
   * Omits days from `days` or days without both start+end → no row for that weekday (day off).
   */
  async setWorkingHoursBatch(dto: StaffWorkingHoursBatchDto) {
    await this.ensureStaffBelongsToBusiness(dto.staffId, dto.businessId);
    const seen = new Set<number>();
    for (const day of dto.days) {
      if (seen.has(day.dayOfWeek)) {
        throw new BadRequestException(`Duplicate dayOfWeek: ${day.dayOfWeek}`);
      }
      seen.add(day.dayOfWeek);
      const hasStart = Boolean(day.startTime?.trim());
      const hasEnd = Boolean(day.endTime?.trim());
      if (hasStart !== hasEnd) {
        throw new BadRequestException(
          `dayOfWeek ${day.dayOfWeek}: provide both startTime and endTime, or neither`,
        );
      }
      if (hasStart && day.startTime && day.endTime) {
        this.validateTimeRange(day.startTime, day.endTime);
      }
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: dto.staffId },
      select: { branchId: true },
    });
    if (!staff) throw new NotFoundException('Staff not found');

    const rows = dto.days
      .filter((d) => d.startTime?.trim() && d.endTime?.trim())
      .map((d) => ({
        staffId: dto.staffId,
        branchId: staff.branchId ?? undefined,
        dayOfWeek: d.dayOfWeek,
        startTime: d.startTime!.trim(),
        endTime: d.endTime!.trim(),
      }));

    const txStartedAt = Date.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.staffWorkingHours.deleteMany({ where: { staffId: dto.staffId } });
      if (rows.length > 0) {
        await tx.staffWorkingHours.createMany({ data: rows });
      }
    });
    const workingHoursTransactionMs = Date.now() - txStartedAt;

    const projectionEnabledRaw = (this.config.get<string>('TIME_SLOT_PROJECTION_ENABLED') ?? '')
      .trim()
      .toLowerCase();
    const projectionEnabled = projectionEnabledRaw === 'true' || projectionEnabledRaw === '1';
    const projectionSyncEnabled =
      projectionEnabled && this.config.get<string>('TIME_SLOT_PROJECTION_SYNC_ENABLED') === 'true';
    let projectionScheduled = false;
    if (projectionSyncEnabled) {
      projectionScheduled = true;
      // Never block the API response on projection regeneration.
      void this.timeSlotProjectionLifecycle
        .regenerateBusinessWindow({
          businessId: dto.businessId,
          staffId: dto.staffId,
          reason: 'staff_working_hours_changed_async',
        })
        .catch((error) => {
          this.logger.warn(
            `[WORKING_HOURS_BATCH] async projection failed staffId=${dto.staffId} businessId=${dto.businessId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }
    const projectionSkipped = !projectionEnabled;

    await this.cache.invalidateStaffValidationBundleForStaff(
      dto.staffId,
      'working_hours_batch_replaced',
    );
    await this.cache.invalidateBusiness(dto.businessId);
    this.logger.log(
      JSON.stringify({
        type: 'WORKING_HOURS_BATCH_COMMIT',
        staffId: dto.staffId,
        businessId: dto.businessId,
        workingHoursTransactionMs,
        projectionScheduled,
        projectionSkipped,
        projectionAwaited: false,
      }),
    );
    return this.findById(dto.staffId);
  }

  async addBreak(dto: StaffBreakDto) {
    await this.ensureStaffBelongsToBusiness(dto.staffId, dto.businessId);
    this.validateTimeRange(dto.startTime, dto.endTime);

    const staff = await this.prisma.staff.findUnique({
      where: { id: dto.staffId },
      select: { branchId: true },
    });
    const created = await this.prisma.staffBreak.create({
      data: {
        staffId: dto.staffId,
        branchId: staff?.branchId ?? undefined,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
    await this.cache.invalidateStaffValidationBundleForStaff(
      dto.staffId,
      'weekly_break_created',
    );
    await this.cache.invalidateBusiness(dto.businessId);
    return created;
  }

  async addBreakException(dto: CreateStaffBreakExceptionDto) {
    await this.ensureStaffBelongsToBusiness(dto.staffId, dto.businessId);
    this.validateTimeRange(dto.startTime, dto.endTime);

    const staff = await this.prisma.staff.findUnique({
      where: { id: dto.staffId },
      select: { branchId: true },
    });
    const date = parseDateOnlyUtc(dto.date);
    const result = await this.prisma.staffBreakException.create({
      data: {
        staffId: dto.staffId,
        branchId: staff?.branchId ?? undefined,
        date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        kind: dto.kind === 'TIME_BLOCK' ? 'TIME_BLOCK' : 'BREAK',
      },
    });
    await this.cache.invalidateStaffValidationBundleForDate(
      dto.staffId,
      dto.date,
      'break_exception_created',
    );
    await this.bustAvailabilityForStaffCalendarDay(dto.businessId, dto.staffId, result.date);
    await this.cache.invalidateBusiness(dto.businessId);
    return result;
  }

  async addBreakExceptionBulk(dto: CreateStaffBreakExceptionBulkDto) {
    await this.ensureStaffBelongsToBusiness(dto.staffId, dto.businessId);
    this.validateTimeRange(dto.startTime, dto.endTime);

    const staff = await this.prisma.staff.findUnique({
      where: { id: dto.staffId },
      select: { branchId: true },
    });
    if (!staff) throw new NotFoundException('Staff not found');

    const start = parseDateOnlyUtc(dto.startDate);
    const end = parseDateOnlyUtc(dto.endDate);
    if (end.getTime() < start.getTime()) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const toCreate: {
      staffId: string;
      branchId: string | null;
      date: Date;
      startTime: string;
      endTime: string;
      kind: 'BREAK';
    }[] = [];
    let dt = new Date(start.getTime());
    const endT = end.getTime();
    const startDowUtc = start.getUTCDay();

    while (dt.getTime() <= endT) {
      if (dto.recurrence === 'ONCE') {
        toCreate.push({
          staffId: dto.staffId,
          branchId: staff.branchId,
          date: new Date(dt.getTime()),
          startTime: dto.startTime,
          endTime: dto.endTime,
          kind: 'BREAK',
        });
        break;
      }
      if (dto.recurrence === 'DAILY') {
        toCreate.push({
          staffId: dto.staffId,
          branchId: staff.branchId,
          date: new Date(dt.getTime()),
          startTime: dto.startTime,
          endTime: dto.endTime,
          kind: 'BREAK',
        });
      }
      if (dto.recurrence === 'WEEKLY' && dt.getUTCDay() === startDowUtc) {
        toCreate.push({
          staffId: dto.staffId,
          branchId: staff.branchId,
          date: new Date(dt.getTime()),
          startTime: dto.startTime,
          endTime: dto.endTime,
          kind: 'BREAK',
        });
      }
      dt = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + 1));
    }

    if (toCreate.length === 0) return { count: 0 };
    const { count } = await this.prisma.staffBreakException.createMany({
      data: toCreate,
    });
    const biz = await this.prisma.business.findUnique({
      where: { id: dto.businessId },
      select: { timezone: true },
    });
    const tz = resolveBusinessTimeZone(biz?.timezone);
    const ymds = new Set<string>();
    for (const row of toCreate) {
      ymds.add(businessLocalYmdFromJsDate(tz, row.date));
    }
    for (const ymd of ymds) {
      await this.cache.invalidateStaffValidationBundleForDate(
        dto.staffId,
        ymd,
        'break_exception_bulk_created',
      );
      await this.cache.invalidateAvailability(dto.staffId, ymd);
    }
    await this.cache.invalidateBusiness(dto.businessId);
    return { count };
  }

  async addBreakBulkWeekly(dto: StaffBreakBulkWeeklyDto) {
    this.validateTimeRange(dto.startTime, dto.endTime);
    const staffList = await this.prisma.staff.findMany({
      where: { id: { in: dto.staffIds }, businessId: dto.businessId, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (staffList.length !== dto.staffIds.length) {
      throw new BadRequestException('One or more staff not found or do not belong to business');
    }
    const toCreate: { staffId: string; branchId: string | null; dayOfWeek: number; startTime: string; endTime: string }[] = [];
    for (const staff of staffList) {
      for (const dayOfWeek of dto.daysOfWeek) {
        toCreate.push({
          staffId: staff.id,
          branchId: staff.branchId,
          dayOfWeek,
          startTime: dto.startTime,
          endTime: dto.endTime,
        });
      }
    }
    if (toCreate.length === 0) return { count: 0 };
    const { count } = await this.prisma.staffBreak.createMany({
      data: toCreate,
    });
    for (const staff of staffList) {
      await this.cache.invalidateStaffValidationBundleForStaff(
        staff.id,
        'weekly_break_bulk_created',
      );
    }
    await this.cache.invalidateBusiness(dto.businessId);
    return { count };
  }

  async addBreakExceptionBulkWeeklyRange(dto: StaffBreakBulkWeeklyRangeDto) {
    this.validateTimeRange(dto.startTime, dto.endTime);
    const start = parseDateOnlyUtc(dto.startDate);
    const end = parseDateOnlyUtc(dto.endDate);
    if (end.getTime() < start.getTime()) {
      throw new BadRequestException('endDate must be after startDate');
    }
    const staffList = await this.prisma.staff.findMany({
      where: { id: { in: dto.staffIds }, businessId: dto.businessId, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (staffList.length !== dto.staffIds.length) {
      throw new BadRequestException('One or more staff not found or do not belong to business');
    }
    const toCreate: {
      staffId: string;
      branchId: string | null;
      date: Date;
      startTime: string;
      endTime: string;
      kind: 'BREAK';
    }[] = [];
    let dt = new Date(start.getTime());
    const endT = end.getTime();
    while (dt.getTime() <= endT) {
      if (dto.daysOfWeek.includes(dt.getUTCDay())) {
        for (const staff of staffList) {
          toCreate.push({
            staffId: staff.id,
            branchId: staff.branchId,
            date: new Date(dt.getTime()),
            startTime: dto.startTime,
            endTime: dto.endTime,
            kind: 'BREAK',
          });
        }
      }
      dt = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + 1));
    }
    if (toCreate.length === 0) return { count: 0 };
    const { count } = await this.prisma.staffBreakException.createMany({
      data: toCreate,
    });
    for (const s of staffList) {
      await this.cache.invalidateStaffValidationBundleForStaff(
        s.id,
        'break_exception_bulk_weekly_range_created',
      );
      await this.cache.invalidateStaff(s.id);
    }
    await this.cache.invalidateBusiness(dto.businessId);
    return { count };
  }

  async getMyBreaks(staffId: string, startDate: string, endDate: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId, deletedAt: null },
    });
    if (!staff) throw new NotFoundException('Staff not found');

    const start = parseDateOnlyUtc(startDate);
    const end = endDateOnlyUtcInclusive(endDate);

    const [weeklyBreaks, exceptions] = await Promise.all([
      this.prisma.staffBreak.findMany({
        where: { staffId },
      }),
      this.prisma.staffBreakException.findMany({
        where: {
          staffId,
          date: { gte: start, lte: end },
        },
      }),
    ]);

    return { weeklyBreaks, exceptions };
  }

  async deleteBreakException(id: string, staffId: string) {
    const rec = await this.prisma.staffBreakException.findFirst({
      where: { id, staffId },
      include: { staff: { select: { businessId: true } } },
    });
    if (!rec) throw new NotFoundException('Break not found');
    await this.prisma.staffBreakException.delete({ where: { id } });
    await this.cache.invalidateStaffValidationBundleForDate(
      staffId,
      businessLocalYmdFromJsDate(
        resolveBusinessTimeZone(
          (
            await this.prisma.business.findUnique({
              where: { id: rec.staff.businessId },
              select: { timezone: true },
            })
          )?.timezone,
        ),
        rec.date,
      ),
      'break_exception_deleted',
    );
    await this.bustAvailabilityForStaffCalendarDay(rec.staff.businessId, staffId, rec.date);
    await this.cache.invalidateBusiness(rec.staff.businessId);
    return { success: true };
  }

  async deleteWeeklyBreak(id: string, staffId: string) {
    const rec = await this.prisma.staffBreak.findFirst({
      where: { id, staffId },
      include: { staff: { select: { businessId: true } } },
    });
    if (!rec) throw new NotFoundException('Break not found');
    await this.prisma.staffBreak.delete({ where: { id } });
    await this.cache.invalidateStaffValidationBundleForStaff(
      staffId,
      'weekly_break_deleted',
    );
    await this.cache.invalidateBusiness(rec.staff.businessId);
    return { success: true };
  }

  /**
   * Break exceptions alter layer-1 busy intervals; `invalidateBusiness` does not touch `av:busy` / `av:day`.
   */
  private async bustAvailabilityForStaffCalendarDay(
    businessId: string,
    staffId: string,
    exceptionDate: Date,
  ): Promise<void> {
    const biz = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    const tz = resolveBusinessTimeZone(biz?.timezone);
    const ymd = businessLocalYmdFromJsDate(tz, exceptionDate);
    await this.cache.invalidateAvailability(staffId, ymd);
  }

  private async invalidateApprovedTimeOffValidationBundle(
    staffId: string,
    businessId: string,
    startDate: Date,
    endDate: Date,
    reason: string,
  ): Promise<void> {
    const biz = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    const tz = resolveBusinessTimeZone(biz?.timezone);
    let ymd = businessLocalYmdFromJsDate(tz, startDate);
    const endYmd = businessLocalYmdFromJsDate(tz, endDate);

    while (ymd <= endYmd) {
      await this.cache.invalidateStaffValidationBundleForDate(
        staffId,
        ymd,
        reason,
      );
      await this.cache.invalidateAvailability(staffId, ymd);
      ymd = addBusinessDaysFromYmd(tz, ymd, 1);
    }
  }

  private async getStaffIdByUserId(userId: string): Promise<string> {
    const staff = await this.prisma.staff.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (!staff) throw new NotFoundException('Staff profile not found');
    return staff.id;
  }

  async getMyBreaksByUserId(userId: string, startDate: string, endDate: string) {
    const staffId = await this.getStaffIdByUserId(userId);
    return this.getMyBreaks(staffId, startDate, endDate);
  }

  async addBreakExceptionByUserId(userId: string, dto: CreateStaffBreakExceptionMeDto) {
    const staffId = await this.getStaffIdByUserId(userId);
    return this.addBreakException({ ...dto, staffId });
  }

  async addBreakExceptionBulkByUserId(userId: string, dto: CreateStaffBreakExceptionBulkMeDto) {
    const staffId = await this.getStaffIdByUserId(userId);
    return this.addBreakExceptionBulk({ ...dto, staffId });
  }

  async deleteBreakExceptionByUserId(userId: string, id: string) {
    const staffId = await this.getStaffIdByUserId(userId);
    return this.deleteBreakException(id, staffId);
  }

  async deleteWeeklyBreakByUserId(userId: string, id: string) {
    const staffId = await this.getStaffIdByUserId(userId);
    return this.deleteWeeklyBreak(id, staffId);
  }

  async addWeeklyBreakByUserId(userId: string, dto: StaffWeeklyBreakMeDto) {
    const staffId = await this.getStaffIdByUserId(userId);
    return this.addBreak({
      staffId,
      businessId: dto.businessId,
      dayOfWeek: dto.dayOfWeek,
      startTime: dto.startTime,
      endTime: dto.endTime,
    });
  }

  async addTimeOff(dto: StaffTimeOffDto) {
    await this.ensureStaffBelongsToBusiness(dto.staffId, dto.businessId);
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate < startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: dto.staffId },
      select: { branchId: true },
    });
    const isAllDay = dto.isAllDay ?? (dto.startTime == null && dto.endTime == null);
    const result = await this.prisma.staffTimeOff.create({
      data: {
        staffId: dto.staffId,
        branchId: staff?.branchId ?? undefined,
        startDate,
        endDate,
        startTime: dto.startTime,
        endTime: dto.endTime,
        reason: dto.reason,
        isAllDay,
        status: 'APPROVED', // Manager-created = auto-approved
      },
    });

    await this.invalidateApprovedTimeOffValidationBundle(
      dto.staffId,
      dto.businessId,
      startDate,
      endDate,
      'time_off_created_approved',
    );
    return result;
  }

  /**
   * Mon–Fri baseline (dayOfWeek 1–5) for new staff. Also used when business onboarding creates the owner staff row.
   */
  async applyDefaultWorkingScheduleForNewStaff(
    staffId: string,
    branchId: string | null | undefined,
  ): Promise<void> {
    await this.seedDefaultWorkingHours(staffId, branchId);
  }

  private async seedDefaultWorkingHours(
    staffId: string,
    branchId: string | null | undefined,
  ): Promise<void> {
    const days = [1, 2, 3, 4, 5] as const;
    await this.prisma.staffWorkingHours.createMany({
      data: days.map((dayOfWeek) => ({
        staffId,
        branchId: branchId ?? undefined,
        dayOfWeek,
        startTime: '09:00',
        endTime: '18:00',
      })),
    });
  }

  async ensureStaffBelongsToBusiness(staffId: string, businessId: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId, deletedAt: null },
    });
    if (!staff) {
      throw new NotFoundException('Staff not found');
    }
    if (staff.businessId !== businessId) {
      throw new ForbiddenException('Staff does not belong to this business');
    }
  }

  private async ensureServicesBelongToBusiness(serviceIds: string[], businessId: string) {
    const services = await this.prisma.service.findMany({
      where: { id: { in: serviceIds }, businessId, deletedAt: null },
    });
    if (services.length !== serviceIds.length) {
      throw new BadRequestException('One or more services not found or do not belong to this business');
    }
  }

  private validateTimeRange(start: string, end: string) {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin <= startMin) {
      throw new BadRequestException('endTime must be after startTime');
    }
  }

  // --- Employee vacation request flow ---

  async requestVacation(userId: string, dto: RequestVacationDto) {
    const staff = await this.prisma.staff.findFirst({
      where: { userId, deletedAt: null },
      include: { branch: true },
    });
    if (!staff) throw new NotFoundException('Staff profile not found');

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate < startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }
    if (dto.startTime && dto.endTime) {
      this.validateTimeRange(dto.startTime, dto.endTime);
    }

    const business = await this.prisma.business.findUnique({
      where: { id: staff.businessId },
      select: { requireEmployeeVacationApproval: true },
    });
    let requireApproval = business?.requireEmployeeVacationApproval ?? true;

    // Manager/owner adds vacation for themselves - no approval needed
    const businessUser = await this.prisma.businessUser.findFirst({
      where: { userId, businessId: staff.businessId, isActive: true },
      include: { role: true },
    });
    if (businessUser && ['owner', 'manager'].includes(businessUser.role.slug)) {
      requireApproval = false;
    }

    const timeOff = await this.prisma.staffTimeOff.create({
      data: {
        staffId: staff.id,
        branchId: staff.branchId ?? undefined,
        startDate,
        endDate,
        startTime: dto.startTime,
        endTime: dto.endTime,
        reason: dto.reason ?? 'vacation',
        isAllDay: dto.isAllDay ?? (dto.startTime == null && dto.endTime == null),
        status: requireApproval ? 'REQUESTED' : 'APPROVED',
      },
    });

    if (!requireApproval) {
      await this.invalidateApprovedTimeOffValidationBundle(
        staff.id,
        staff.businessId,
        startDate,
        endDate,
        'vacation_request_auto_approved',
      );
    }
    if (requireApproval) {
      await this.notifyManagersVacationRequest(staff.businessId, staff.id, staff.firstName, staff.lastName, timeOff.id);
    } else {
    }

    return timeOff;
  }

  private async notifyManagersVacationRequest(
    businessId: string,
    staffId: string,
    firstName: string,
    lastName: string,
    timeOffId: string,
  ) {
    const managers = await this.prisma.businessUser.findMany({
      where: {
        businessId,
        isActive: true,
        role: { slug: { in: ['owner', 'manager'] } },
      },
      select: { userId: true },
    });
    const staffName = `${firstName} ${lastName}`.trim() || 'Employee';
    for (const m of managers) {
      await this.prisma.notification.create({
        data: {
          businessId,
          userId: m.userId,
          type: 'vacation_requested',
          title: 'Employee requested vacation',
          body: `${staffName} requested time off.`,
          data: { timeOffId, staffId, staffName },
          channel: 'IN_APP',
        },
      });
    }
  }

  async cancelOwnVacation(userId: string, timeOffId: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!staff) throw new NotFoundException('Staff profile not found');

    const timeOff = await this.prisma.staffTimeOff.findFirst({
      where: { id: timeOffId, staffId: staff.id },
    });
    if (!timeOff) throw new NotFoundException('Vacation not found');
    if (timeOff.status !== 'REQUESTED') {
      throw new BadRequestException('Only REQUESTED vacations can be cancelled');
    }

    await this.prisma.staffTimeOff.update({
      where: { id: timeOffId },
      data: { status: 'CANCELLED' },
    });
    return { success: true };
  }

  async listTeamVacations(businessId: string, branchId?: string, startDate?: string, endDate?: string) {
    const where: Record<string, unknown> = {
      staff: { businessId, deletedAt: null },
    };
    if (branchId) {
      where.OR = [{ branchId }, { branchId: null }];
    }
    if (startDate && endDate) {
      where.startDate = { lte: new Date(endDate) };
      where.endDate = { gte: new Date(startDate) };
    }

    const rows = await this.prisma.staffTimeOff.findMany({
      where,
      include: {
        staff: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            user: { select: { avatarUrl: true } },
          },
        },
      },
      orderBy: [{ startDate: 'asc' }, { endDate: 'asc' }],
    });
    return rows.map((r) => ({
      ...r,
      staff: {
        id: r.staff.id,
        firstName: r.staff.firstName,
        lastName: r.staff.lastName,
        avatarUrl: r.staff.avatarUrl ?? r.staff.user?.avatarUrl ?? null,
      },
    }));
  }

  async approveVacation(timeOffId: string, businessId: string) {
    const timeOff = await this.prisma.staffTimeOff.findUnique({
      where: { id: timeOffId },
      include: { staff: true },
    });
    if (!timeOff) throw new NotFoundException('Vacation not found');
    if (timeOff.staff.businessId !== businessId) {
      throw new ForbiddenException('Vacation does not belong to this business');
    }
    if (timeOff.status !== 'REQUESTED') {
      throw new BadRequestException('Only REQUESTED vacations can be approved');
    }

    await this.prisma.staffTimeOff.update({
      where: { id: timeOffId },
      data: { status: 'APPROVED' },
    });
    await this.invalidateApprovedTimeOffValidationBundle(
      timeOff.staffId,
      businessId,
      timeOff.startDate,
      timeOff.endDate,
      'vacation_approved',
    );
    return { success: true };
  }

  async rejectVacation(timeOffId: string, businessId: string) {
    const timeOff = await this.prisma.staffTimeOff.findUnique({
      where: { id: timeOffId },
      include: { staff: true },
    });
    if (!timeOff) throw new NotFoundException('Vacation not found');
    if (timeOff.staff.businessId !== businessId) {
      throw new ForbiddenException('Vacation does not belong to this business');
    }
    if (timeOff.status !== 'REQUESTED') {
      throw new BadRequestException('Only REQUESTED vacations can be rejected');
    }

    await this.prisma.staffTimeOff.update({
      where: { id: timeOffId },
      data: { status: 'REJECTED' },
    });
    return { success: true };
  }

  async deleteVacation(timeOffId: string, businessId: string) {
    const timeOff = await this.prisma.staffTimeOff.findUnique({
      where: { id: timeOffId },
      include: { staff: true },
    });
    if (!timeOff) throw new NotFoundException('Vacation not found');
    if (timeOff.staff.businessId !== businessId) {
      throw new ForbiddenException('Vacation does not belong to this business');
    }

    await this.prisma.staffTimeOff.delete({
      where: { id: timeOffId },
    });
    if (timeOff.status === 'APPROVED') {
      await this.invalidateApprovedTimeOffValidationBundle(
        timeOff.staffId,
        businessId,
        timeOff.startDate,
        timeOff.endDate,
        'vacation_deleted_approved',
      );
    }
    return { success: true };
  }

  /**
   * רשימת עובדים פעילים + שעות + הפסקות + חופש + ספירת סלוטי זמינות לכל שירות
   * (חלון של 5 ימי חול ראשונים — לפי יומן ואזור זמן של העסק, מיושר עם getAvailabilityDayMap).
   */
  async getScheduleSnapshot(
    businessId: string,
    branchId?: string,
    printToServerConsole = false,
  ) {
    const dayCount = 5;

    const bizRow = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    const timeZone = resolveBusinessTimeZone(bizRow?.timezone);
    const anchorYmd = this.nextFirstBusinessWeekdayYmd(timeZone);

    const dates: string[] = [];
    for (let i = 0; i < dayCount; i++) {
      dates.push(addBusinessDaysFromYmd(timeZone, anchorYmd, i));
    }

    const rangeStart = new Date(businessLocalDayBounds(timeZone, dates[0]!).startMs);
    const rangeEndExclusive = new Date(
      businessLocalDayBounds(timeZone, dates[dates.length - 1]!).endMs,
    );

    const hebDays = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

    const list = await this.prisma.staff.findMany({
      where: {
        businessId,
        deletedAt: null,
        isActive: true,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        branch: { select: { id: true, name: true } },
        staffWorkingHours: { orderBy: { dayOfWeek: 'asc' } },
        staffBreaks: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
        staffBreakExceptions: {
          where: {
            date: { gte: rangeStart, lt: rangeEndExclusive },
          },
          orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        },
        staffTimeOff: {
          where: { status: VacationStatus.APPROVED },
          orderBy: { startDate: 'asc' },
        },
        staffServices: {
          where: { allowBooking: true },
          include: {
            service: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    type ServiceAv = {
      serviceId: string;
      serviceName: string;
      perDay: { date: string; slotCount: number; slots: string[] }[];
      totalSlotOptions: number;
    };

    const staffPayload: Array<{
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      branch: { id: string; name: string } | null;
      isActive: boolean;
      workingHoursByDay: Array<{
        dayOfWeek: number;
        dayLabelHe: string;
        startTime: string;
        endTime: string;
      }>;
      breaksByDay: Array<{
        dayOfWeek: number;
        dayLabelHe: string;
        startTime: string;
        endTime: string;
      }>;
      /** הפסקות לפי תאריך (טבלת staff_break_exceptions) בתוך חלון הצילום בלבד */
      breakExceptionsInWindow: Array<{
        date: string;
        startTime: string;
        endTime: string;
      }>;
      timeOff: Array<{
        id: string;
        startDate: string;
        endDate: string;
        isAllDay: boolean;
        startTime: string | null;
        endTime: string | null;
        reason: string | null;
      }>;
      servicesAvailability: ServiceAv[];
      summary: {
        servicesWithBooking: number;
        totalSlotOptionsAllServices: number;
      };
    }> = [];

    for (const s of list) {
      const workingHoursByDay = (s.staffWorkingHours ?? []).map((h) => ({
        dayOfWeek: h.dayOfWeek,
        dayLabelHe: hebDays[h.dayOfWeek] ?? String(h.dayOfWeek),
        startTime: h.startTime,
        endTime: h.endTime,
      }));
      const breaksByDay = (s.staffBreaks ?? []).map((b) => ({
        dayOfWeek: b.dayOfWeek,
        dayLabelHe: hebDays[b.dayOfWeek] ?? String(b.dayOfWeek),
        startTime: b.startTime,
        endTime: b.endTime,
      }));
      const breakExceptionsInWindow = (s.staffBreakExceptions ?? []).map((e) => ({
        date: businessLocalYmdFromJsDate(timeZone, e.date),
        startTime: e.startTime,
        endTime: e.endTime,
      }));
      const timeOff = (s.staffTimeOff ?? []).map((t) => ({
        id: t.id,
        startDate: t.startDate.toISOString().slice(0, 10),
        endDate: t.endDate.toISOString().slice(0, 10),
        isAllDay: t.isAllDay,
        startTime: t.startTime,
        endTime: t.endTime,
        reason: t.reason,
      }));

      const servicesAvailability: ServiceAv[] = [];
      for (const ss of s.staffServices) {
        const dayMap = await this.computed.getAvailabilityDayMap(
          businessId,
          s.id,
          ss.service.id,
          anchorYmd,
          dayCount,
          { businessTimeZone: timeZone },
        );
        const perDay: ServiceAv['perDay'] = [];
        let total = 0;
        for (let i = 0; i < dayCount; i++) {
          const date = dates[i]!;
          const slots = dayMap.get(date)?.slots ?? [];
          total += slots.length;
          perDay.push({ date, slotCount: slots.length, slots: [...slots] });
        }
        servicesAvailability.push({
          serviceId: ss.service.id,
          serviceName: ss.service.name,
          perDay,
          totalSlotOptions: total,
        });
      }

      staffPayload.push({
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.email,
        phone: s.phone,
        branch: s.branch ?? null,
        isActive: s.isActive,
        workingHoursByDay,
        breaksByDay,
        breakExceptionsInWindow,
        timeOff,
        servicesAvailability,
        summary: {
          servicesWithBooking: s.staffServices.length,
          totalSlotOptionsAllServices: servicesAvailability.reduce(
            (a, x) => a + x.totalSlotOptions,
            0,
          ),
        },
      });
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      businessId,
      branchId: branchId ?? null,
      anchorFirstWeekdayYmd: anchorYmd,
      daysComputed: dayCount,
      staffCount: staffPayload.length,
      staff: staffPayload,
    };

    if (printToServerConsole || this.config.get<string>('LOG_STAFF_SCHEDULE_SNAPSHOT') === '1') {
      this.printScheduleSnapshotHebrew(payload);
    }

    return payload;
  }

  /** יום עבודה הבא (ב״–ו׳) ביומן של אזור העסק — תואם את חישוב הזמינות. */
  private nextFirstBusinessWeekdayYmd(timeZone: string): string {
    const today = DateTime.now().setZone(timeZone).startOf('day');
    for (let i = 1; i <= 21; i++) {
      const dt = today.plus({ days: i });
      const wd = dt.weekday;
      if (wd >= 1 && wd <= 5) return dt.toISODate()!;
    }
    return today.plus({ days: 1 }).toISODate()!;
  }

  private printScheduleSnapshotHebrew(payload: {
    generatedAt: string;
    businessId: string;
    anchorFirstWeekdayYmd: string;
    daysComputed: number;
    staffCount: number;
    staff: Array<{
      id: string;
      firstName: string;
      lastName: string;
      workingHoursByDay: Array<{ dayLabelHe: string; startTime: string; endTime: string }>;
      breaksByDay: Array<{ dayLabelHe: string; startTime: string; endTime: string }>;
      breakExceptionsInWindow: Array<{ date: string; startTime: string; endTime: string }>;
      timeOff: Array<{
        startDate: string;
        endDate: string;
        isAllDay: boolean;
        reason: string | null;
      }>;
      servicesAvailability: Array<{
        serviceName: string;
        totalSlotOptions: number;
        perDay: Array<{ date: string; slotCount: number; slots: string[] }>;
      }>;
      summary: { totalSlotOptionsAllServices: number; servicesWithBooking: number };
    }>;
  }): void {
    console.log('\n═════════ צילום לוח עבודה / Staff schedule snapshot ═════════');
    console.log(
      `נוצר: ${payload.generatedAt} | יום עיגון: ${payload.anchorFirstWeekdayYmd} | ${payload.daysComputed} ימים`,
    );
    console.log(`עסק: ${payload.businessId} | עובדים: ${payload.staffCount}\n`);
    for (const s of payload.staff) {
      console.log(`▸ ${s.firstName} ${s.lastName} [${s.id}]`);
      console.log('  שעות עבודה:');
      for (const h of s.workingHoursByDay) {
        console.log(`    ${h.dayLabelHe}: ${h.startTime}–${h.endTime}`);
      }
      if (s.breaksByDay.length) {
        console.log('  הפסקות (שבועיות):');
        for (const b of s.breaksByDay) {
          console.log(`    ${b.dayLabelHe}: ${b.startTime}–${b.endTime}`);
        }
      }
      if (s.breakExceptionsInWindow.length) {
        console.log('  הפסקות לפי תאריך (בחלון הצילום):');
        for (const e of s.breakExceptionsInWindow) {
          console.log(`    ${e.date}: ${e.startTime}–${e.endTime}`);
        }
      }
      if (s.timeOff.length) {
        console.log('  חופש מאושר:');
        for (const t of s.timeOff) {
          console.log(`    ${t.startDate} → ${t.endDate} allDay=${t.isAllDay} ${t.reason ?? ''}`);
        }
      }
      console.log('  זמנים פנויים (סלוטים) לפי שירות:');
      for (const svc of s.servicesAvailability) {
        console.log(`    ★ ${svc.serviceName} — סה"כ אפשרויות בטווח: ${svc.totalSlotOptions}`);
        for (const d of svc.perDay) {
          const preview = d.slots.slice(0, 12).join(', ');
          const more = d.slotCount > 12 ? ` ... (+${d.slotCount - 12})` : '';
          console.log(`      ${d.date}: ${d.slotCount} slots [${preview}${more}]`);
        }
      }
      console.log(
        `  [SUMMARY] bookable services: ${s.summary.servicesWithBooking} | total slot options (all services): ${s.summary.totalSlotOptionsAllServices}\n`,
      );
    }
    console.log('=== End staff schedule snapshot ===\n');
  }
}
