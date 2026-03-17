import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/** Normalize phone to digits; Israeli 050/9725 formats match. */
function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

function isPhoneBlocked(phone: string | undefined, blockedList: string[]): boolean {
  if (!phone || !blockedList?.length) return false;
  const digits = phoneDigits(phone);
  if (!digits.length) return false;
  for (const b of blockedList) {
    const bDigits = phoneDigits(b);
    if (digits === bDigits) return true;
    if (bDigits.startsWith('0') && digits === '972' + bDigits.slice(1)) return true;
    if (digits.startsWith('0') && bDigits === '972' + digits.slice(1)) return true;
    if (bDigits.startsWith('972') && digits === '0' + bDigits.slice(3)) return true;
    if (digits.startsWith('972') && bDigits === '0' + digits.slice(3)) return true;
  }
  return false;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async create(businessId: string, dto: CreateCustomerDto) {
    if (dto.phone) {
      const business = await this.prisma.business.findUnique({
        where: { id: businessId, deletedAt: null },
        select: { settings: true },
      });
      const settings = business?.settings as { blockedPhones?: string[] } | null;
      const blocked = settings?.blockedPhones ?? [];
      if (isPhoneBlocked(dto.phone, blocked)) {
        throw new BadRequestException('PHONE_BLOCKED');
      }
    }

    const existing = await this.prisma.customer.findFirst({
      where: {
        businessId,
        email: dto.email,
        deletedAt: null,
      },
    });
    if (existing) {
      throw new ConflictException('Email already in use by another customer');
    }

    const customer = await this.prisma.customer.create({
      data: {
        businessId,
        branchId: dto.branchId,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        gender: dto.gender,
        tagColor: dto.tagColor,
        notes: dto.notes,
      },
      include: {
        branch: { select: { id: true, name: true } },
      },
    });

    const customerName =
      [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email;
    this.notifications
      .notifyCustomerRegistered({
        businessId,
        customerId: customer.id,
        customerName,
      })
      .catch((e: unknown) => console.warn('[Customers] notifyCustomerRegistered failed:', e));

    return customer;
  }

  async findAll(businessId: string, branchId?: string, search?: string) {
    const where: {
      businessId: string;
      deletedAt: null;
      branchId?: string;
      OR?: Array<{ [key: string]: unknown }>;
    } = {
      businessId,
      deletedAt: null,
    };
    if (branchId) where.branchId = branchId;
    if (search && search.trim()) {
      const term = search.trim();
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
      ];
    }

    return this.prisma.customer.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async findById(id: string, businessId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, businessId, deletedAt: null },
      include: {
        branch: { select: { id: true, name: true } },
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async update(id: string, businessId: string, dto: UpdateCustomerDto) {
    await this.ensureCustomerBelongsToBusiness(id, businessId);

    if (dto.phone) {
      const business = await this.prisma.business.findUnique({
        where: { id: businessId, deletedAt: null },
        select: { settings: true },
      });
      const settings = business?.settings as { blockedPhones?: string[] } | null;
      const blocked = settings?.blockedPhones ?? [];
      if (isPhoneBlocked(dto.phone, blocked)) {
        throw new BadRequestException('PHONE_BLOCKED');
      }
    }

    if (dto.email) {
      const existing = await this.prisma.customer.findFirst({
        where: {
          businessId,
          email: dto.email,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (existing) {
        throw new ConflictException('Email already in use by another customer');
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.birthDate !== undefined) data.birthDate = dto.birthDate ? new Date(dto.birthDate) : null;
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.tagColor !== undefined) data.tagColor = dto.tagColor;
    if (dto.branchId !== undefined) data.branchId = dto.branchId;
    if (dto.notes !== undefined) data.notes = dto.notes;

    return this.prisma.customer.update({
      where: { id },
      data,
      include: {
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async delete(id: string, businessId: string) {
    await this.ensureCustomerBelongsToBusiness(id, businessId);
    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { success: true };
  }

  private async ensureCustomerBelongsToBusiness(customerId: string, businessId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, deletedAt: null },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    if (customer.businessId !== businessId) {
      throw new ForbiddenException('Customer does not belong to this business');
    }
  }
}
