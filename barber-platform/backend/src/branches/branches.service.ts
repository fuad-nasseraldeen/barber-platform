import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ServicesService } from '../services/services.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly services: ServicesService,
  ) {}

  async create(businessId: string, dto: Omit<CreateBranchDto, 'businessId'>) {
    await this.ensureBusinessExists(businessId);

    if (dto.copyFromBranchId) {
      await this.ensureBranchBelongsToBusiness(dto.copyFromBranchId, businessId);
    }

    const branch = await this.prisma.branch.create({
      data: {
        businessId,
        name: dto.name,
        address: dto.address,
        city: dto.city,
        lat: dto.lat,
        lng: dto.lng,
        phone: dto.phone,
      },
    });

    if (dto.copyFromBranchId) {
      if (dto.copyServices) {
        const sourceServices = await this.prisma.service.findMany({
          where: { branchId: dto.copyFromBranchId, businessId },
        });
        for (const svc of sourceServices) {
          await this.services.duplicateToBranch(svc.id, businessId, branch.id);
        }
      }

      if (dto.moveStaffIds?.length) {
        const staffInBranch = await this.prisma.staff.findMany({
          where: {
            id: { in: dto.moveStaffIds },
            branchId: dto.copyFromBranchId,
            businessId,
            deletedAt: null,
          },
        });
        if (staffInBranch.length !== dto.moveStaffIds.length) {
          throw new BadRequestException(
            'Some staff do not belong to the source branch',
          );
        }
        await this.prisma.staff.updateMany({
          where: { id: { in: dto.moveStaffIds } },
          data: { branchId: branch.id },
        });
      }
    }

    return branch;
  }

  async findAll(businessId: string) {
    return this.prisma.branch.findMany({
      where: { businessId },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  async update(id: string, businessId: string, dto: UpdateBranchDto) {
    await this.ensureBranchBelongsToBusiness(id, businessId);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.lat !== undefined) data.lat = dto.lat;
    if (dto.lng !== undefined) data.lng = dto.lng;
    if (dto.phone !== undefined) data.phone = dto.phone;
    return this.prisma.branch.update({
      where: { id },
      data,
    });
  }

  async delete(id: string, businessId: string) {
    await this.ensureBranchBelongsToBusiness(id, businessId);
    await this.prisma.branch.delete({
      where: { id },
    });
    return { success: true };
  }

  private async ensureBusinessExists(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId, deletedAt: null },
    });
    if (!business) {
      throw new NotFoundException('Business not found');
    }
  }

  private async ensureBranchBelongsToBusiness(branchId: string, businessId: string) {
    const branch = await this.findById(branchId);
    if (branch.businessId !== businessId) {
      throw new ForbiddenException('Branch does not belong to this business');
    }
  }
}
