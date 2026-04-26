import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { isSchedulerPrimaryInstance } from '../common/scheduler-instance';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { CreateWaitlistDto } from './dto/create-waitlist.dto';
import { UpdateWaitlistDto } from './dto/update-waitlist.dto';
import { ConvertWaitlistDto } from './dto/convert-waitlist.dto';

const WAITLIST_RESERVE_MINUTES = 15;

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async create(dto: CreateWaitlistDto) {
    await this.ensureCustomerBelongsToBusiness(dto.customerId, dto.businessId);
    await this.ensureServiceBelongsToBusiness(dto.serviceId, dto.businessId);
    if (dto.staffId) {
      await this.ensureStaffCanPerformService(dto.staffId, dto.serviceId);
    }

    const priority = dto.priority ?? 0;

    const waitlist = await this.prisma.waitlist.create({
      data: {
        businessId: dto.businessId,
        branchId: dto.branchId,
        customerId: dto.customerId,
        serviceId: dto.serviceId,
        staffId: dto.staffId,
        locationId: dto.locationId,
        preferredDateStart: dto.preferredDateStart
          ? new Date(dto.preferredDateStart)
          : undefined,
        preferredDateEnd: dto.preferredDateEnd
          ? new Date(dto.preferredDateEnd)
          : undefined,
        preferredTimeStart: dto.preferredTimeStart,
        preferredTimeEnd: dto.preferredTimeEnd,
        priority,
        notes: dto.notes,
      },
      include: {
        customer: { select: { firstName: true, lastName: true, email: true, phone: true } },
        service: { select: { name: true } },
      },
    });

    const customerName =
      waitlist.customer.firstName ?? waitlist.customer.lastName ?? waitlist.customer.email ?? 'Customer';
    this.notifications
      .notifyWaitlistJoined({
        businessId: dto.businessId,
        customerName,
        serviceName: waitlist.service.name,
      })
      .catch((e: unknown) => console.warn('[Waitlist] notifyWaitlistJoined failed:', e));

    return waitlist;
  }

  async findAll(
    businessId: string,
    status?: string,
    branchId?: string,
    page = 1,
    limit = 20,
  ) {
    const where: {
      businessId: string;
      status?: import('@prisma/client').WaitlistStatus;
      branchId?: string;
    } = {
      businessId,
    };
    if (status && ['ACTIVE', 'NOTIFIED', 'CONVERTED', 'CANCELLED'].includes(status)) {
      where.status = status as import('@prisma/client').WaitlistStatus;
    }
    if (branchId) {
      where.branchId = branchId;
    }

    const skip = (page - 1) * limit;
    return this.prisma.waitlist.findMany({
      where,
      skip,
      take: limit,
      include: {
        customer: { select: { firstName: true, lastName: true, email: true, phone: true } },
        service: { select: { name: true } },
        staff: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findById(id: string, viewerBusinessId?: string) {
    const wl = await this.prisma.waitlist.findUnique({
      where: { id },
      include: {
        customer: true,
        service: true,
        staff: true,
        business: { select: { name: true } },
      },
    });
    if (!wl) throw new NotFoundException('Waitlist entry not found');
    if (viewerBusinessId && wl.businessId !== viewerBusinessId) {
      throw new ForbiddenException('Waitlist does not belong to this business');
    }
    return wl;
  }

  async update(id: string, businessId: string, dto: UpdateWaitlistDto) {
    await this.ensureWaitlistBelongsToBusiness(id, businessId);

    return this.prisma.waitlist.update({
      where: { id },
      data: {
        preferredDateStart: dto.preferredDateStart
          ? new Date(dto.preferredDateStart)
          : undefined,
        preferredDateEnd: dto.preferredDateEnd
          ? new Date(dto.preferredDateEnd)
          : undefined,
        preferredTimeStart: dto.preferredTimeStart,
        preferredTimeEnd: dto.preferredTimeEnd,
        priority: dto.priority,
        status: dto.status,
        notes: dto.notes,
      },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
      },
    });
  }

  async cancel(id: string, businessId: string) {
    await this.ensureWaitlistBelongsToBusiness(id, businessId);

    return this.prisma.waitlist.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * Process a slot that became available (e.g. after cancellation).
   * Picks next ACTIVE waitlist entry, marks NOTIFIED with expiry (opaque session id only).
   */
  async processSlotAvailable(params: {
    businessId: string;
    staffId: string;
    serviceId: string;
    date: string;
    startTime: string;
  }): Promise<{ notified: boolean; waitlistId?: string; expiresAt?: Date }> {
    const { businessId, staffId, serviceId, date, startTime } = params;

    const service = await this.prisma.service.findUnique({
      where: { id: serviceId, businessId, deletedAt: null },
    });
    if (!service) return { notified: false };

    const next = await this.getNextWaitlistEntry(businessId, serviceId, staffId, date, startTime);
    if (!next) return { notified: false };

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + WAITLIST_RESERVE_MINUTES);

    const sessionId = randomUUID();

    await this.prisma.waitlist.update({
      where: { id: next.id },
      data: {
        status: 'NOTIFIED',
        notifiedAt: new Date(),
        notifiedSessionId: sessionId,
        notifiedStaffId: staffId,
        notifiedDate: date,
        notifiedStartTime: startTime,
        expiresAt,
      },
    });

    await this.notifyWaitlistCustomer(next, date, startTime, WAITLIST_RESERVE_MINUTES);

    return {
      notified: true,
      waitlistId: next.id,
      expiresAt,
    };
  }

  /**
   * NOTIFIED row must match the slot the client is converting (no Redis lock).
   */
  async validateNotifiedSlotMatches(dto: ConvertWaitlistDto): Promise<boolean> {
    const wl = await this.prisma.waitlist.findUnique({
      where: { id: dto.waitlistId },
      select: {
        status: true,
        expiresAt: true,
        customerId: true,
        serviceId: true,
        notifiedStaffId: true,
        notifiedDate: true,
        notifiedStartTime: true,
      },
    });
    if (!wl || wl.status !== 'NOTIFIED' || !wl.notifiedStaffId || !wl.notifiedStartTime) {
      return false;
    }
    if (wl.expiresAt && new Date() > wl.expiresAt) return false;
    if (wl.customerId !== dto.customerId) return false;
    if (wl.serviceId !== dto.serviceId) return false;
    const nd = new Date(wl.notifiedDate as Date | string).toISOString().slice(0, 10);
    if (nd !== dto.date.slice(0, 10)) return false;
    if (wl.notifiedStaffId !== dto.staffId) return false;
    if (wl.notifiedStartTime !== dto.startTime) return false;
    return true;
  }

  /**
   * Mark waitlist as CONVERTED after appointment is created.
   */
  async markConverted(waitlistId: string, appointmentId: string): Promise<void> {
    await this.prisma.waitlist.update({
      where: { id: waitlistId },
      data: {
        status: 'CONVERTED',
        convertedToAppointmentId: appointmentId,
        expiresAt: null,
        notifiedSessionId: null,
      },
    });
  }

  /**
   * Revert NOTIFIED to ACTIVE when reservation expires.
   */
  async revertExpiredNotified(waitlistId: string): Promise<void> {
    const wl = await this.prisma.waitlist.findUnique({
      where: { id: waitlistId },
    });
    if (!wl || wl.status !== 'NOTIFIED') return;
    if (!wl.expiresAt || new Date() <= wl.expiresAt) return;

    await this.prisma.waitlist.update({
      where: { id: waitlistId },
      data: {
        status: 'ACTIVE',
        notifiedAt: null,
        notifiedSessionId: null,
        notifiedStaffId: null,
        notifiedDate: null,
        notifiedStartTime: null,
        expiresAt: null,
      },
    });
  }

  @Cron('* * * * *')
  async handleExpiredNotified(): Promise<void> {
    if (!isSchedulerPrimaryInstance()) return;
    try {
      await this.processExpiredNotified();
    } catch (err) {
      this.logger.warn(
        `handleExpiredNotified skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Process all expired NOTIFIED entries (cron job).
   */
  async processExpiredNotified(): Promise<number> {
    const expired = await this.prisma.waitlist.findMany({
      where: {
        status: 'NOTIFIED',
        expiresAt: { lt: new Date() },
      },
    });

    for (const wl of expired) {
      await this.revertExpiredNotified(wl.id);
    }
    return expired.length;
  }

  private async getNextWaitlistEntry(
    businessId: string,
    serviceId: string,
    staffId: string,
    date: string,
    startTime: string,
  ) {
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay();
    const [h, m] = startTime.split(':').map(Number);
    const slotMinutes = h * 60 + m;

    const entries = await this.prisma.waitlist.findMany({
      where: {
        businessId,
        serviceId,
        status: 'ACTIVE',
        OR: [{ staffId: null }, { staffId }],
      },
      include: {
        customer: true,
        service: true,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 20,
    });

    for (const e of entries) {
      if (e.staffId && e.staffId !== staffId) continue;

      if (e.preferredDateStart || e.preferredDateEnd) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        if (e.preferredDateStart && new Date(e.preferredDateStart) > d) continue;
        if (e.preferredDateEnd && new Date(e.preferredDateEnd) < d) continue;
      }

      if (e.preferredTimeStart || e.preferredTimeEnd) {
        const [psh, psm] = (e.preferredTimeStart ?? '00:00').split(':').map(Number);
        const [peh, pem] = (e.preferredTimeEnd ?? '23:59').split(':').map(Number);
        const pStart = psh * 60 + psm;
        const pEnd = peh * 60 + pem;
        if (slotMinutes < pStart || slotMinutes >= pEnd) continue;
      }

      return e;
    }
    return null;
  }

  private async notifyWaitlistCustomer(
    waitlist: {
      id: string;
      businessId: string;
      customerId: string;
      customer: { phone?: string | null; email?: string; firstName?: string | null; lastName?: string | null };
      service: { name: string };
    },
    date: string,
    startTime: string,
    reserveMinutes: number,
  ) {
    const customerName = waitlist.customer.firstName ?? waitlist.customer.lastName ?? 'there';
    await this.notifications
      .notifyWaitlistSlotAvailable({
        businessId: waitlist.businessId,
        customerId: waitlist.customerId,
        customerName,
        serviceName: waitlist.service.name,
        date,
        startTime,
        reserveMinutes,
        phone: waitlist.customer.phone ?? undefined,
        email: waitlist.customer.email,
      })
      .catch((e: unknown) => console.warn('[Waitlist] Failed to queue notification:', e));
  }

  private async ensureWaitlistBelongsToBusiness(id: string, businessId: string) {
    const wl = await this.prisma.waitlist.findUnique({ where: { id } });
    if (!wl) throw new NotFoundException('Waitlist entry not found');
    if (wl.businessId !== businessId) throw new ForbiddenException('Waitlist does not belong to this business');
  }

  private async ensureCustomerBelongsToBusiness(customerId: string, businessId: string) {
    const c = await this.prisma.customer.findUnique({
      where: { id: customerId, businessId, deletedAt: null },
    });
    if (!c) throw new NotFoundException('Customer not found');
  }

  private async ensureServiceBelongsToBusiness(serviceId: string, businessId: string) {
    const s = await this.prisma.service.findUnique({
      where: { id: serviceId, businessId, deletedAt: null },
    });
    if (!s) throw new NotFoundException('Service not found');
  }

  private async ensureStaffCanPerformService(staffId: string, serviceId: string) {
    const link = await this.prisma.staffService.findUnique({
      where: { staffId_serviceId: { staffId, serviceId } },
    });
    if (!link) throw new BadRequestException('Staff does not perform this service');
  }
}
