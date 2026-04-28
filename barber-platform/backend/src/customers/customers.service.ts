import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/** Normalize phone to digits; Israeli 050/9725 formats match. */
function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

type NoShowRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

type CustomerWithNoShowRisk = {
  id: string;
  noShowRisk: {
    score: number;
    level: NoShowRiskLevel;
    flagged: boolean;
    noShowCount: number;
    totalAppointments: number;
  };
};

/** Compare two phone strings as the same subscriber (IL 050 vs 97250…). */
function phonesEquivalent(a: string, b: string): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da.length || !db.length) return false;
  const norm = (d: string) => {
    if (d.startsWith('972') && d.length >= 11) return `0${d.slice(3)}`;
    return d;
  };
  return norm(da) === norm(db);
}

function syntheticCustomerEmail(): string {
  return `customer-${randomUUID()}@placeholder.barber`;
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

  private calculateNoShowRisk(
    totalAppointments: number,
    noShowCount: number,
    recentAppointments: number,
    recentNoShows: number,
  ) {
    if (totalAppointments <= 0) {
      return {
        score: 0,
        level: 'LOW' as NoShowRiskLevel,
        flagged: false,
        noShowCount: 0,
        totalAppointments: 0,
      };
    }

    const noShowRate = noShowCount / totalAppointments;
    const recentNoShowRate =
      recentAppointments > 0 ? recentNoShows / recentAppointments : 0;
    const score = Math.min(
      100,
      Math.round(
        noShowRate * 60 + recentNoShowRate * 30 + Math.min(recentNoShows, 3) * 10,
      ),
    );
    const level: NoShowRiskLevel =
      score >= 60 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW';

    return {
      score,
      level,
      flagged: level !== 'LOW',
      noShowCount,
      totalAppointments,
    };
  }

  private async attachNoShowRisk<T extends { id: string }>(
    customers: T[],
    businessId: string,
  ): Promise<Array<T & CustomerWithNoShowRisk>> {
    if (!customers.length) return [] as Array<T & CustomerWithNoShowRisk>;

    const customerIds = customers.map((c) => c.id);
    const recentStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [totalByCustomer, noShowByCustomer, recentByCustomer, recentNoShowByCustomer] =
      await Promise.all([
        this.prisma.appointment.groupBy({
          by: ['customerId'],
          where: {
            businessId,
            customerId: { in: customerIds },
          },
          _count: { _all: true },
        }),
        this.prisma.appointment.groupBy({
          by: ['customerId'],
          where: {
            businessId,
            customerId: { in: customerIds },
            status: 'NO_SHOW',
          },
          _count: { _all: true },
        }),
        this.prisma.appointment.groupBy({
          by: ['customerId'],
          where: {
            businessId,
            customerId: { in: customerIds },
            startTime: { gte: recentStart },
          },
          _count: { _all: true },
        }),
        this.prisma.appointment.groupBy({
          by: ['customerId'],
          where: {
            businessId,
            customerId: { in: customerIds },
            startTime: { gte: recentStart },
            status: 'NO_SHOW',
          },
          _count: { _all: true },
        }),
      ]);

    const totalMap = new Map(totalByCustomer.map((r) => [r.customerId, r._count._all]));
    const noShowMap = new Map(noShowByCustomer.map((r) => [r.customerId, r._count._all]));
    const recentMap = new Map(recentByCustomer.map((r) => [r.customerId, r._count._all]));
    const recentNoShowMap = new Map(
      recentNoShowByCustomer.map((r) => [r.customerId, r._count._all]),
    );

    return customers.map((customer) => {
      const totalAppointments = totalMap.get(customer.id) ?? 0;
      const noShowCount = noShowMap.get(customer.id) ?? 0;
      const recentAppointments = recentMap.get(customer.id) ?? 0;
      const recentNoShows = recentNoShowMap.get(customer.id) ?? 0;

      return {
        ...customer,
        noShowRisk: this.calculateNoShowRisk(
          totalAppointments,
          noShowCount,
          recentAppointments,
          recentNoShows,
        ),
      };
    });
  }

  private async findCustomerWithSamePhone(
    businessId: string,
    phone: string,
    excludeCustomerId?: string,
  ) {
    const rows = await this.prisma.customer.findMany({
      where: {
        businessId,
        deletedAt: null,
        phone: { not: null },
        ...(excludeCustomerId ? { id: { not: excludeCustomerId } } : {}),
      },
      select: { id: true, phone: true },
    });
    return rows.find((r) => r.phone && phonesEquivalent(r.phone, phone)) ?? null;
  }

  async create(businessId: string, dto: CreateCustomerDto) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId, deletedAt: null },
      select: { settings: true },
    });
    const settings = business?.settings as { blockedPhones?: string[] } | null;
    const blocked = settings?.blockedPhones ?? [];
    if (isPhoneBlocked(dto.phone, blocked)) {
      throw new BadRequestException('PHONE_BLOCKED');
    }

    const dupPhone = await this.findCustomerWithSamePhone(businessId, dto.phone);
    if (dupPhone) {
      throw new ConflictException('Phone already in use by another customer');
    }

    let email: string;
    let attempts = 0;
    do {
      email = syntheticCustomerEmail();
      const clash = await this.prisma.customer.findFirst({
        where: { businessId, email, deletedAt: null },
      });
      if (!clash) break;
      attempts += 1;
    } while (attempts < 10);
    if (attempts >= 10) {
      throw new ConflictException('Could not allocate unique email for customer');
    }

    const customer = await this.prisma.customer.create({
      data: {
        businessId,
        branchId: dto.branchId,
        email,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone.trim(),
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

    const customers = await this.prisma.customer.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return this.attachNoShowRisk(customers, businessId);
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
    const [withRisk] = await this.attachNoShowRisk([customer], businessId);
    return withRisk;
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
      const dupPhone = await this.findCustomerWithSamePhone(businessId, dto.phone, id);
      if (dupPhone) {
        throw new ConflictException('Phone already in use by another customer');
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
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
