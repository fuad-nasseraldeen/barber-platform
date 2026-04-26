import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { AssignStaffToServiceDto } from './dto/assign-staff.dto';
import { UpdateServiceBlocksDto } from './dto/update-service-blocks.dto';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private slugFromName(name: string): string {
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

  async create(businessId: string, dto: CreateServiceDto) {
    await this.ensureBusinessExists(businessId);
    if (dto.branchId) {
      await this.ensureBranchBelongsToBusiness(dto.branchId, businessId);
    }
    const slug = dto.slug ?? this.slugFromName(dto.name);
    const branchId = dto.branchId ?? null;
    let existing = await this.prisma.service.findFirst({
      where: { businessId, branchId, slug, deletedAt: null },
      include: {
        staffServices: { include: { staff: true } },
        staffBlocks: { select: { staffId: true } },
        branch: true,
      },
    });

    if (existing) {
      if (dto.staffAssignments?.length) {
        await this.assignStaffWithDetails(existing.id, businessId, dto.staffAssignments, existing.branchId);
        await this.invalidateValidationBundlesForStaffIds(
          dto.staffAssignments.map((a) => a.staffId),
          'service_existing_assignments_updated',
        );
        return this.findById(existing.id);
      }
      return this.serializeServiceListRow(existing);
    }

    const maxOrder = await this.prisma.service.aggregate({
      where: { businessId, branchId, deletedAt: null },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxOrder._max?.sortOrder ?? -1) + 1;

    const service = await this.prisma.service.create({
      data: {
        businessId,
        branchId,
        categoryId: dto.categoryId,
        name: dto.name,
        slug,
        description: dto.description,
        durationMinutes: 30,
        price: 0,
        color: dto.color,
        isActive: dto.isActive ?? true,
        sortOrder,
      },
      include: {
        staffServices: { include: { staff: true } },
        staffBlocks: { select: { staffId: true } },
        branch: true,
      },
    });

    if (dto.staffAssignments?.length) {
      await this.assignStaffWithDetails(service.id, businessId, dto.staffAssignments, service.branchId);
      await this.invalidateValidationBundlesForStaffIds(
        dto.staffAssignments.map((a) => a.staffId),
        'service_created_with_staff_assignments',
      );
      return this.findById(service.id);
    }
    return this.serializeServiceListRow(service);
  }

  private async assignStaffWithDetails(
    serviceId: string,
    businessId: string,
    staffAssignments: { staffId: string; durationMinutes: number; price: number }[],
    serviceBranchId: string | null,
    replace = false,
  ) {
    if (staffAssignments.length === 0 && !replace) return;
    const staff = await this.prisma.staff.findMany({
      where: { id: { in: staffAssignments.map((a) => a.staffId) }, businessId, deletedAt: null },
    });
    if (staff.length !== staffAssignments.length) {
      throw new ForbiddenException('One or more staff not found or do not belong to this business');
    }
    if (serviceBranchId) {
      const wrongBranch = staff.filter((s) => s.branchId !== serviceBranchId);
      if (wrongBranch.length > 0) {
        throw new ForbiddenException('Staff must belong to the same branch as the service');
      }
    }
    if (replace) {
      await this.prisma.staffService.deleteMany({ where: { serviceId } });
    }
    for (const a of staffAssignments) {
      await this.prisma.staffService.upsert({
        where: {
          staffId_serviceId: { staffId: a.staffId, serviceId },
        },
        create: {
          serviceId,
          staffId: a.staffId,
          durationMinutes: a.durationMinutes,
          price: a.price,
        },
        update: { durationMinutes: a.durationMinutes, price: a.price },
      });
    }
  }

  async findAll(
    businessId: string,
    categoryId?: string,
    includeInactive = false,
    branchId?: string,
  ) {
    const where: { businessId: string; deletedAt: null; categoryId?: string; branchId?: string | null; isActive?: boolean } = {
      businessId,
      deletedAt: null,
    };
    if (categoryId) where.categoryId = categoryId;
    if (branchId !== undefined) where.branchId = branchId;
    if (!includeInactive) where.isActive = true;

    const rows = await this.prisma.service.findMany({
      where,
      include: {
        staffServices: { include: { staff: true } },
        staffBlocks: { select: { staffId: true } },
        branch: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((s) => this.serializeServiceListRow(s));
  }

  private serializeServiceListRow(
    s: Record<string, unknown> & { staffBlocks?: { staffId: string }[] },
  ) {
    const { staffBlocks, ...rest } = s;
    return {
      ...rest,
      blockedStaffIds: (staffBlocks ?? []).map((b) => b.staffId),
    };
  }

  async findById(id: string, viewerBusinessId?: string) {
    const service = await this.prisma.service.findUnique({
      where: { id, deletedAt: null },
      include: {
        staffServices: { include: { staff: true } },
        staffBlocks: { select: { staffId: true } },
        category: true,
      },
    });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    if (viewerBusinessId && service.businessId !== viewerBusinessId) {
      throw new ForbiddenException('Service does not belong to this business');
    }
    return this.serializeServiceListRow(service);
  }

  async update(id: string, businessId: string, dto: UpdateServiceDto) {
    await this.ensureServiceBelongsToBusiness(id, businessId);

    const data: Record<string, unknown> = {};
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.durationMinutes !== undefined) data.durationMinutes = dto.durationMinutes;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.service.update({
      where: { id },
      data,
      include: {
        staffServices: { include: { staff: true } },
        staffBlocks: { select: { staffId: true } },
      },
    });
    await this.invalidateValidationBundlesForServiceStaff(
      id,
      'service_metadata_updated',
    );
    return this.serializeServiceListRow(updated);
  }

  async delete(id: string, businessId: string) {
    await this.ensureServiceBelongsToBusiness(id, businessId);
    await this.invalidateValidationBundlesForServiceStaff(
      id,
      'service_deleted',
    );
    await this.prisma.service.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { success: true };
  }

  async reorder(businessId: string, serviceIds: string[]) {
    await this.ensureBusinessExists(businessId);
    const services = await this.prisma.service.findMany({
      where: { id: { in: serviceIds }, businessId, deletedAt: null },
    });
    if (services.length !== serviceIds.length) {
      throw new ForbiddenException('One or more services not found or do not belong to this business');
    }

    await this.prisma.$transaction(
      serviceIds.map((serviceId, index) =>
        this.prisma.service.update({
          where: { id: serviceId },
          data: { sortOrder: index },
        }),
      ),
    );

    return this.findAll(businessId, undefined, true);
  }

  async assignStaff(serviceId: string, businessId: string, dto: AssignStaffToServiceDto) {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId, deletedAt: null },
    });
    if (!service || service.businessId !== businessId) {
      throw new NotFoundException('Service not found');
    }

    const staffAssignments = dto.staffAssignments ?? (dto.staffIds ?? []).map((staffId) => ({
      staffId,
      durationMinutes: 30,
      price: 0,
    }));

    await this.assignStaffWithDetails(
      serviceId,
      businessId,
      staffAssignments,
      service.branchId,
      true,
    );
    await this.invalidateValidationBundlesForStaffIds(
      staffAssignments.map((a) => a.staffId),
      'service_staff_assignments_replaced',
    );

    return this.findById(serviceId);
  }

  async updateAvailabilityBlocks(
    serviceId: string,
    businessId: string,
    dto: UpdateServiceBlocksDto,
  ) {
    await this.ensureServiceBelongsToBusiness(serviceId, businessId);
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (!service) throw new NotFoundException('Service not found');

    const blockedStaffIds = dto.blockAllStaff ? [] : [...new Set(dto.blockedStaffIds)];

    if (blockedStaffIds.length > 0) {
      const staffRows = await this.prisma.staff.findMany({
        where: {
          id: { in: blockedStaffIds },
          businessId,
          deletedAt: null,
        },
        select: { id: true, branchId: true },
      });
      if (staffRows.length !== blockedStaffIds.length) {
        throw new BadRequestException('One or more staff not found in this business');
      }
      if (service.branchId) {
        const wrong = staffRows.filter((s) => s.branchId && s.branchId !== service.branchId);
        if (wrong.length > 0) {
          throw new BadRequestException('Blocked staff must belong to the same branch as the service');
        }
      }
    }

    const beforeLinks = await this.prisma.staffService.findMany({
      where: { serviceId },
      select: { staffId: true },
    });
    const affectedStaff = new Set(beforeLinks.map((l) => l.staffId));

    await this.prisma.$transaction(async (tx) => {
      await tx.service.update({
        where: { id: serviceId },
        data: { blockAllStaff: dto.blockAllStaff },
      });
      await tx.serviceStaffBlock.deleteMany({ where: { serviceId } });
      if (!dto.blockAllStaff && blockedStaffIds.length > 0) {
        await tx.serviceStaffBlock.createMany({
          data: blockedStaffIds.map((staffId) => ({ serviceId, staffId })),
        });
      }
      if (dto.blockAllStaff) {
        await tx.staffService.deleteMany({ where: { serviceId } });
      } else if (blockedStaffIds.length > 0) {
        await tx.staffService.deleteMany({
          where: { serviceId, staffId: { in: blockedStaffIds } },
        });
      }
    });

    await this.invalidateValidationBundlesForStaffIds(
      [...affectedStaff, ...blockedStaffIds],
      'service_availability_blocks_updated',
    );

    return this.findById(serviceId);
  }

  private async invalidateValidationBundlesForServiceStaff(
    serviceId: string,
    reason: string,
  ): Promise<void> {
    const rows = await this.prisma.staffService.findMany({
      where: { serviceId },
      select: { staffId: true },
    });
    await this.invalidateValidationBundlesForStaffIds(
      rows.map((row) => row.staffId),
      reason,
    );
  }

  private async invalidateValidationBundlesForStaffIds(
    staffIds: string[],
    reason: string,
  ): Promise<void> {
    const unique = [...new Set(staffIds.filter(Boolean))];
    for (const staffId of unique) {
      await this.cache.invalidateStaffValidationBundleForStaff(staffId, reason);
    }
  }

  private async ensureBusinessExists(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId, deletedAt: null },
    });
    if (!business) {
      throw new NotFoundException('Business not found');
    }
  }

  async duplicateToBranch(serviceId: string, businessId: string, targetBranchId: string) {
    await this.ensureServiceBelongsToBusiness(serviceId, businessId);
    await this.ensureBranchBelongsToBusiness(targetBranchId, businessId);

    const source = await this.prisma.service.findUnique({
      where: { id: serviceId, deletedAt: null },
    });
    if (!source) throw new NotFoundException('Service not found');

    const slug = this.slugFromName(source.name);
    const existing = await this.prisma.service.findFirst({
      where: { businessId, branchId: targetBranchId, slug, deletedAt: null },
      include: {
        staffServices: { include: { staff: true } },
        staffBlocks: { select: { staffId: true } },
        branch: true,
      },
    });
    if (existing) {
      return this.serializeServiceListRow(existing);
    }

    const maxOrder = await this.prisma.service.aggregate({
      where: { businessId, branchId: targetBranchId, deletedAt: null },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxOrder._max?.sortOrder ?? -1) + 1;

    const created = await this.prisma.service.create({
      data: {
        businessId,
        branchId: targetBranchId,
        categoryId: source.categoryId,
        name: source.name,
        slug,
        description: source.description,
        durationMinutes: 30,
        price: 0,
        color: source.color,
        bufferBeforeMinutes: source.bufferBeforeMinutes,
        bufferAfterMinutes: source.bufferAfterMinutes,
        isActive: source.isActive,
        sortOrder,
        blockAllStaff: false,
      },
      include: {
        staffServices: { include: { staff: true } },
        staffBlocks: { select: { staffId: true } },
        branch: true,
      },
    });
    return this.serializeServiceListRow(created);
  }

  private async ensureBranchBelongsToBusiness(branchId: string, businessId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch || branch.businessId !== businessId) {
      throw new NotFoundException('Branch not found');
    }
  }

  private async ensureServiceBelongsToBusiness(serviceId: string, businessId: string) {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId, deletedAt: null },
    });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    if (service.businessId !== businessId) {
      throw new ForbiddenException('Service does not belong to this business');
    }
  }
}
