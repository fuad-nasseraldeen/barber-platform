import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService, CACHE_TTL } from '../redis/cache.service';
import { AvailabilityWorkerService } from '../availability/availability-worker.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { RegisterStaffDto } from './dto/register-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffServicesDto } from './dto/staff-services.dto';
import { StaffWorkingHoursDto } from './dto/staff-working-hours.dto';
import { StaffBreakDto } from './dto/staff-break.dto';
import {
  CreateStaffBreakExceptionDto,
  CreateStaffBreakExceptionBulkDto,
} from './dto/staff-break-exception.dto';
import {
  StaffBreakBulkWeeklyDto,
  StaffBreakBulkWeeklyRangeDto,
} from './dto/staff-break-bulk-weekly.dto';
import { StaffTimeOffDto } from './dto/staff-time-off.dto';
import { UpdateMyServicesDto } from './dto/update-my-services.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { RequestVacationDto } from './dto/request-vacation.dto';
import { VacationStatus } from '@prisma/client';

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
    private readonly availabilityWorker: AvailabilityWorkerService,
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
        user: { select: { avatarUrl: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip,
      take: limit,
    });
    return list.map(({ user, ...s }) => ({
      ...s,
      avatarUrl: s.avatarUrl ?? user?.avatarUrl ?? null,
    }));
  }

  async findById(id: string) {
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
    return staff;
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
      },
      include: { branch: true, location: true },
    });
  }

  async updateStaffServices(
    staffId: string,
    businessId: string,
    dto: { updates: Array<{ staffServiceId: string; durationMinutes?: number; price?: number }> },
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
          ...(u.durationMinutes != null && { durationMinutes: u.durationMinutes }),
          ...(u.price != null && { price: u.price }),
        },
      });
    }

    await this.cache.invalidateBusiness(businessId);
    return this.findById(staffId);
  }

  async addStaffService(
    staffId: string,
    dto: { businessId: string; serviceId: string; durationMinutes?: number; price?: number },
  ) {
    await this.ensureStaffBelongsToBusiness(staffId, dto.businessId);
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
    await this.availabilityWorker.invalidateAndQueueForStaff(id, 0);
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
          ...(u.durationMinutes != null && { durationMinutes: u.durationMinutes }),
          ...(u.price != null && { price: u.price }),
        },
      });
    }

    await this.cache.invalidateBusiness(staff.businessId);
    return this.findMyProfile(userId);
  }

  async addServiceToMyself(
    userId: string,
    dto: { serviceId: string; durationMinutes?: number; price?: number },
  ) {
    const staff = await this.prisma.staff.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!staff) {
      throw new NotFoundException('Staff profile not found');
    }
    await this.addStaffService(staff.id, {
      businessId: staff.businessId,
      serviceId: dto.serviceId,
      durationMinutes: dto.durationMinutes,
      price: dto.price,
    });
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

    await this.prisma.staffService.deleteMany({
      where: { staffId: dto.staffId },
    });
    await this.prisma.staffService.createMany({
      data: dto.serviceIds.map((serviceId) => ({
        staffId: dto.staffId,
        serviceId,
      })),
    });
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

    await this.invalidateAvailabilityForStaff(dto.staffId);
    return result;
  }

  async addBreak(dto: StaffBreakDto) {
    await this.ensureStaffBelongsToBusiness(dto.staffId, dto.businessId);
    this.validateTimeRange(dto.startTime, dto.endTime);

    const staff = await this.prisma.staff.findUnique({
      where: { id: dto.staffId },
      select: { branchId: true },
    });
    return this.prisma.staffBreak.create({
      data: {
        staffId: dto.staffId,
        branchId: staff?.branchId ?? undefined,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
  }

  async addBreakException(dto: CreateStaffBreakExceptionDto) {
    await this.ensureStaffBelongsToBusiness(dto.staffId, dto.businessId);
    this.validateTimeRange(dto.startTime, dto.endTime);

    const staff = await this.prisma.staff.findUnique({
      where: { id: dto.staffId },
      select: { branchId: true },
    });
    const date = new Date(dto.date);
    date.setHours(0, 0, 0, 0);
    const result = await this.prisma.staffBreakException.create({
      data: {
        staffId: dto.staffId,
        branchId: staff?.branchId ?? undefined,
        date,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
    await this.invalidateAvailabilityForStaff(dto.staffId);
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

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const toCreate: { staffId: string; branchId: string | null; date: Date; startTime: string; endTime: string }[] = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);

    while (cursor <= end) {
      if (dto.recurrence === 'ONCE') {
        toCreate.push({
          staffId: dto.staffId,
          branchId: staff.branchId,
          date: new Date(cursor),
          startTime: dto.startTime,
          endTime: dto.endTime,
        });
        break;
      }
      if (dto.recurrence === 'DAILY') {
        toCreate.push({
          staffId: dto.staffId,
          branchId: staff.branchId,
          date: new Date(cursor),
          startTime: dto.startTime,
          endTime: dto.endTime,
        });
      }
      if (dto.recurrence === 'WEEKLY') {
        const origStart = new Date(start);
        if (cursor.getDay() === origStart.getDay()) {
          toCreate.push({
            staffId: dto.staffId,
            branchId: staff.branchId,
            date: new Date(cursor),
            startTime: dto.startTime,
            endTime: dto.endTime,
          });
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    if (toCreate.length === 0) return { count: 0 };
    const { count } = await this.prisma.staffBreakException.createMany({
      data: toCreate,
    });
    await this.invalidateAvailabilityForStaff(dto.staffId);
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
    for (const staffId of dto.staffIds) {
      await this.invalidateAvailabilityForStaff(staffId);
    }
    return { count };
  }

  async addBreakExceptionBulkWeeklyRange(dto: StaffBreakBulkWeeklyRangeDto) {
    this.validateTimeRange(dto.startTime, dto.endTime);
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) {
      throw new BadRequestException('endDate must be after startDate');
    }
    const staffList = await this.prisma.staff.findMany({
      where: { id: { in: dto.staffIds }, businessId: dto.businessId, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (staffList.length !== dto.staffIds.length) {
      throw new BadRequestException('One or more staff not found or do not belong to business');
    }
    const toCreate: { staffId: string; branchId: string | null; date: Date; startTime: string; endTime: string }[] = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= end) {
      if (dto.daysOfWeek.includes(cursor.getDay())) {
        for (const staff of staffList) {
          toCreate.push({
            staffId: staff.id,
            branchId: staff.branchId,
            date: new Date(cursor),
            startTime: dto.startTime,
            endTime: dto.endTime,
          });
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (toCreate.length === 0) return { count: 0 };
    const { count } = await this.prisma.staffBreakException.createMany({
      data: toCreate,
    });
    for (const staffId of dto.staffIds) {
      await this.invalidateAvailabilityForStaff(staffId);
    }
    return { count };
  }

  async getMyBreaks(staffId: string, startDate: string, endDate: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId, deletedAt: null },
    });
    if (!staff) throw new NotFoundException('Staff not found');

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

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
    });
    if (!rec) throw new NotFoundException('Break not found');
    await this.prisma.staffBreakException.delete({ where: { id } });
    await this.invalidateAvailabilityForStaff(staffId);
    return { success: true };
  }

  async deleteWeeklyBreak(id: string, staffId: string) {
    const rec = await this.prisma.staffBreak.findFirst({
      where: { id, staffId },
    });
    if (!rec) throw new NotFoundException('Break not found');
    await this.prisma.staffBreak.delete({ where: { id } });
    await this.invalidateAvailabilityForStaff(staffId);
    return { success: true };
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

  async addBreakExceptionByUserId(
    userId: string,
    dto: Omit<CreateStaffBreakExceptionDto, 'staffId'> & { businessId: string },
  ) {
    const staffId = await this.getStaffIdByUserId(userId);
    return this.addBreakException({ ...dto, staffId });
  }

  async addBreakExceptionBulkByUserId(
    userId: string,
    dto: Omit<CreateStaffBreakExceptionBulkDto, 'staffId'> & { businessId: string },
  ) {
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

  async addWeeklyBreakByUserId(
    userId: string,
    dto: { businessId: string; dayOfWeek: number; startTime: string; endTime: string },
  ) {
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

    await this.invalidateAvailabilityForStaff(dto.staffId);
    return result;
  }

  private async invalidateAvailabilityForStaff(staffId: string): Promise<void> {
    const raw = this.config.get('BOOKING_WINDOW_DAYS', '90');
    const windowDays = parseInt(raw, 10) || 90;
    await this.availabilityWorker.invalidateAndQueueForStaff(staffId, windowDays);
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

    if (requireApproval) {
      await this.notifyManagersVacationRequest(staff.businessId, staff.id, staff.firstName, staff.lastName, timeOff.id);
    } else {
      await this.invalidateAvailabilityForStaff(staff.id);
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
    await this.invalidateAvailabilityForStaff(timeOff.staffId);
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
      await this.invalidateAvailabilityForStaff(timeOff.staffId);
    }
    return { success: true };
  }
}
