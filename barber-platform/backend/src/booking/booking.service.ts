import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SlotLockService } from '../booking/slot-lock.service';
import { AvailabilityService } from '../availability/availability.service';
import { StaffService } from '../staff/staff.service';
import { NotificationService } from '../notifications/notification.service';
import { ArrivalConfirmationService } from '../notifications/arrival-confirmation.service';
import { AutomationService } from '../automation/automation.service';
import { CustomerVisitsService } from '../customer-visits/customer-visits.service';
import { LockSlotDto } from './dto/lock-slot.dto';
import { ConfirmBookingDto } from './dto/confirm-booking.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { AvailabilityQueryDto } from './dto/availability-query.dto';

export interface AvailabilityResult {
  date: string;
  staffId: string;
  staffName: string;
  serviceId?: string;
  slots: string[];
}

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slotLock: SlotLockService,
    private readonly availability: AvailabilityService,
    private readonly staff: StaffService,
    private readonly notifications: NotificationService,
    private readonly arrivalConfirmation: ArrivalConfirmationService,
    private readonly customerVisits: CustomerVisitsService,
    private readonly automation: AutomationService,
  ) {}

  /**
   * List appointments for a business with optional filters.
   */
  async findAll(
    businessId: string,
    opts?: {
      branchId?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      staffId?: string;
      customerId?: string;
      limit?: number;
      page?: number;
    },
  ) {
    const limit = opts?.limit ?? 50;
    const page = opts?.page ?? 1;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      businessId,
    };
    if (opts?.branchId) where.branchId = opts.branchId;
    if (opts?.staffId) where.staffId = opts.staffId;
    if (opts?.customerId) where.customerId = opts.customerId;
    if (opts?.status) where.status = opts.status;

    if (opts?.startDate || opts?.endDate) {
      where.startTime = {};
      if (opts.startDate) (where.startTime as Record<string, Date>).gte = new Date(opts.startDate);
      if (opts.endDate) {
        const end = new Date(opts.endDate);
        end.setHours(23, 59, 59, 999);
        (where.startTime as Record<string, Date>).lte = end;
      }
    }

    const orderBy = opts?.startDate || opts?.endDate
      ? { startTime: 'asc' as const }
      : { startTime: 'desc' as const };

    const [appointments, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        include: {
          staff: { select: { id: true, firstName: true, lastName: true } },
          service: { select: { id: true, name: true, durationMinutes: true } },
          customer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, tagColor: true } },
          branch: { select: { id: true, name: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return { appointments, total, page, limit };
  }

  /**
   * Get availability for staff/services within booking window.
   */
  async getAvailability(query: AvailabilityQueryDto): Promise<AvailabilityResult[]> {
    const days = query.days ?? 1;
    const results: AvailabilityResult[] = [];

    const staffList = query.staffId
      ? await this.prisma.staff.findMany({
          where: { id: query.staffId, isActive: true, deletedAt: null },
          include: { staffServices: { include: { service: true } } },
        })
      : await this.staff.findAll(query.businessId, false, query.branchId);

    for (let d = 0; d < days; d++) {
      const dte = new Date(query.date);
      dte.setDate(dte.getDate() + d);
      const dateStr = dte.toISOString().slice(0, 10);

      if (!this.availability.isWithinBookingWindow(dateStr)) continue;

      for (const staff of staffList) {
        const services = query.serviceId
          ? staff.staffServices.filter((ss) => ss.serviceId === query.serviceId)
          : staff.staffServices;

        for (const ss of services) {
          if (query.serviceId && ss.serviceId !== query.serviceId) continue;

          const duration = ss.durationMinutes;
          const totalMinutes =
            duration +
            (ss.service.bufferBeforeMinutes ?? 0) +
            (ss.service.bufferAfterMinutes ?? 0);
          const slots = await this.availability.getAvailableSlots(
            staff.id,
            dateStr,
            totalMinutes,
          );

          if (slots.length === 0) continue;

          const staffName = `${staff.firstName} ${staff.lastName}`;
          const existing = results.find(
            (r) =>
              r.date === dateStr &&
              r.staffId === staff.id &&
              r.serviceId === ss.serviceId,
          );
          if (existing) {
            existing.slots = [...new Set([...existing.slots, ...slots])].sort();
          } else {
            results.push({
              date: dateStr,
              staffId: staff.id,
              staffName,
              serviceId: ss.serviceId,
              slots,
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Lock a slot for booking. Locks all 30-min slots covered by the service duration.
   * Lock expires in 10 minutes (Redis TTL).
   */
  async lockSlot(dto: LockSlotDto) {
    await this.validateSlotForLock(dto);

    const [service, staffService] = await Promise.all([
      this.prisma.service.findUnique({
        where: { id: dto.serviceId, businessId: dto.businessId, deletedAt: null },
      }),
      this.prisma.staffService.findUnique({
        where: {
          staffId_serviceId: { staffId: dto.staffId, serviceId: dto.serviceId },
        },
      }),
    ]);
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    const duration = staffService?.durationMinutes ?? service.durationMinutes;
    const totalMinutes =
      duration +
      (service.bufferBeforeMinutes ?? 0) +
      (service.bufferAfterMinutes ?? 0);

    const result = await this.slotLock.acquireLockForDuration(
      dto.staffId,
      dto.date,
      dto.startTime,
      totalMinutes,
      dto.sessionId,
    );

    if (!result.success) {
      throw new ConflictException('Slot is no longer available');
    }

    return {
      success: true,
      sessionId: result.sessionId,
      staffId: dto.staffId,
      serviceId: dto.serviceId,
      date: dto.date,
      startTime: dto.startTime,
      expiresIn: 600, // 10 min in seconds
    };
  }

  /**
   * Create appointment manually (admin). Bypasses slot lock.
   */
  async createAppointment(dto: CreateAppointmentDto) {
    const [service, staffService] = await Promise.all([
      this.prisma.service.findUnique({
        where: { id: dto.serviceId, businessId: dto.businessId, deletedAt: null },
      }),
      this.prisma.staffService.findUnique({
        where: {
          staffId_serviceId: { staffId: dto.staffId, serviceId: dto.serviceId },
        },
      }),
    ]);
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    const duration = staffService?.durationMinutes ?? service.durationMinutes;
    const totalMinutes =
      duration +
      (service.bufferBeforeMinutes ?? 0) +
      (service.bufferAfterMinutes ?? 0);

    await this.ensureStaffCanPerformService(dto.staffId, dto.serviceId);
    await this.ensureCustomerBelongsToBusiness(dto.customerId, dto.businessId);

    const staff = await this.prisma.staff.findUnique({
      where: { id: dto.staffId },
      select: { branchId: true },
    });
    const branchId = dto.branchId ?? staff?.branchId ?? undefined;

    const startTime = new Date(`${dto.date}T${dto.startTime}:00`);
    const endTime = new Date(startTime.getTime() + totalMinutes * 60 * 1000);

    const slotKey = `${dto.businessId}:${dto.staffId}:${dto.date}:${dto.startTime}`;

    const appointment = await this.prisma.appointment.create({
      data: {
        businessId: dto.businessId,
        branchId,
        locationId: dto.locationId,
        customerId: dto.customerId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        startTime,
        endTime,
        status: 'CONFIRMED',
        slotKey,
        notes: dto.notes,
      },
      include: {
        staff: { select: { id: true, firstName: true, lastName: true } },
        service: { select: { id: true, name: true, durationMinutes: true } },
        customer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    this.notifications
      .notifyAppointmentBooked({
        businessId: dto.businessId,
        customerId: dto.customerId,
        appointmentId: appointment.id,
        customerName:
          appointment.customer.firstName ?? appointment.customer.lastName ?? 'there',
        serviceName: appointment.service.name,
        date: dto.date,
        startTime: dto.startTime,
        phone: appointment.customer.phone ?? undefined,
        email: appointment.customer.email,
      })
      .catch((e: unknown) => console.error('[Booking] notifyAppointmentBooked failed:', e));

    this.arrivalConfirmation
      .sendIfEnabled(appointment.id)
      .catch((e: unknown) => console.error('[Booking] arrivalConfirmation failed:', e));

    this.automation
      .scheduleAppointmentReminder(appointment.id, dto.businessId, startTime)
      .catch((e: unknown) => console.error('[Booking] scheduleAppointmentReminder failed:', e));

    return appointment;
  }

  /**
   * Confirm booking. Creates appointment and releases lock.
   * Double-booking prevented by DB constraint + lock verification.
   */
  async confirmBooking(dto: ConfirmBookingDto) {
    const [service, staffService] = await Promise.all([
      this.prisma.service.findUnique({
        where: { id: dto.serviceId, businessId: dto.businessId, deletedAt: null },
      }),
      this.prisma.staffService.findUnique({
        where: {
          staffId_serviceId: { staffId: dto.staffId, serviceId: dto.serviceId },
        },
      }),
    ]);
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    const duration = staffService?.durationMinutes ?? service.durationMinutes;
    const totalMinutes =
      duration +
      (service.bufferBeforeMinutes ?? 0) +
      (service.bufferAfterMinutes ?? 0);

    const sessionId = dto.sessionId ?? '';
    const hasLock = sessionId
      ? await this.slotLock.verifyLockForDuration(
          dto.staffId,
          dto.date,
          dto.startTime,
          totalMinutes,
          sessionId,
        )
      : false;

    if (!hasLock) {
      throw new ConflictException(
        'Slot lock expired or invalid. Please select a new time.',
      );
    }

    await this.ensureStaffCanPerformService(dto.staffId, dto.serviceId);
    await this.ensureCustomerBelongsToBusiness(dto.customerId, dto.businessId);

    const staff = await this.prisma.staff.findUnique({
      where: { id: dto.staffId },
      select: { branchId: true },
    });
    const branchId = dto.branchId ?? staff?.branchId ?? undefined;

    const startTime = new Date(`${dto.date}T${dto.startTime}:00`);
    const endTime = new Date(startTime.getTime() + totalMinutes * 60 * 1000);

    const slotKey = `${dto.businessId}:${dto.staffId}:${dto.date}:${dto.startTime}`;

    try {
      const appointment = await this.prisma.appointment.create({
        data: {
          businessId: dto.businessId,
          branchId,
          locationId: dto.locationId,
          customerId: dto.customerId,
          staffId: dto.staffId,
          serviceId: dto.serviceId,
          startTime,
          endTime,
          status: 'CONFIRMED',
          slotKey,
          notes: dto.notes,
        },
        include: {
          staff: { select: { firstName: true, lastName: true } },
          service: { select: { name: true, durationMinutes: true } },
          customer: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      });

      this.notifications
        .notifyAppointmentBooked({
          businessId: dto.businessId,
          customerId: dto.customerId,
          appointmentId: appointment.id,
          customerName:
            appointment.customer.firstName ?? appointment.customer.lastName ?? 'there',
          serviceName: appointment.service.name,
          date: dto.date,
          startTime: dto.startTime,
          phone: appointment.customer.phone ?? undefined,
          email: appointment.customer.email,
        })
        .catch((e: unknown) => console.error('[Booking] notifyAppointmentBooked failed:', e));

      this.arrivalConfirmation
        .sendIfEnabled(appointment.id)
        .catch((e: unknown) => console.error('[Booking] arrivalConfirmation failed:', e));

      this.automation
        .scheduleAppointmentReminder(appointment.id, dto.businessId, startTime)
        .catch((e: unknown) => console.error('[Booking] scheduleAppointmentReminder failed:', e));

      await this.slotLock.releaseLockForDuration(
        dto.staffId,
        dto.date,
        dto.startTime,
        totalMinutes,
      );

      return appointment;
    } catch (e: unknown) {
      const prismaError = e as { code?: string };
      if (prismaError?.code === 'P2002') {
        throw new ConflictException('This slot was just booked by someone else');
      }
      throw e;
    }
  }

  /**
   * Cancel an appointment.
   */
  async cancelAppointment(
    appointmentId: string,
    businessId: string,
    reason?: string,
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }
    if (appointment.businessId !== businessId) {
      throw new ForbiddenException('Appointment does not belong to this business');
    }
    if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(appointment.status)) {
      throw new BadRequestException(
        `Cannot cancel appointment with status ${appointment.status}`,
      );
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
      include: {
        staff: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
    });

    const dateStr = updated.startTime.toISOString().slice(0, 10);
    const startTime = updated.startTime.toISOString().slice(11, 16);
    const customerName =
      updated.customer.firstName ?? updated.customer.lastName ?? 'Customer';
    this.notifications
      .notifyAppointmentCancelled({
        businessId: updated.businessId,
        customerName,
        serviceName: updated.service.name,
        date: dateStr,
        startTime,
      })
      .catch((e: unknown) => console.warn('[Booking] notifyAppointmentCancelled failed:', e));

    this.customerVisits
      .createFromAppointment(
        appointmentId,
        'CANCELLED',
        0,
      )
      .catch((e) => console.error('[Booking] createFromAppointment failed:', e));

    return updated;
  }

  async updateAppointmentStatus(
    appointmentId: string,
    businessId: string,
    status: 'COMPLETED' | 'NO_SHOW',
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        service: { select: { price: true } },
        payment: { select: { amount: true, status: true } },
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }
    if (appointment.businessId !== businessId) {
      throw new ForbiddenException('Appointment does not belong to this business');
    }
    if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(appointment.status)) {
      throw new BadRequestException(
        `Cannot update appointment with status ${appointment.status}`,
      );
    }

    let price = 0;
    if (status === 'COMPLETED') {
      if (appointment.payment?.status === 'SUCCEEDED') {
        price = Number(appointment.payment.amount);
      } else {
        const staffService = await this.prisma.staffService.findUnique({
          where: {
            staffId_serviceId: {
              staffId: appointment.staffId,
              serviceId: appointment.serviceId,
            },
          },
        });
        price = staffService
          ? Number(staffService.price)
          : Number(appointment.service.price);
      }
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status },
      include: {
        staff: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
    });

    this.customerVisits
      .createFromAppointment(appointmentId, status, price)
      .catch((e) => console.error('[Booking] createFromAppointment failed:', e));

    return updated;
  }

  private async validateSlotForLock(dto: LockSlotDto) {
    if (!this.availability.isWithinBookingWindow(dto.date)) {
      throw new BadRequestException('Date is outside the booking window');
    }

    const [service, staffService] = await Promise.all([
      this.prisma.service.findUnique({
        where: { id: dto.serviceId, businessId: dto.businessId, deletedAt: null },
      }),
      this.prisma.staffService.findUnique({
        where: {
          staffId_serviceId: { staffId: dto.staffId, serviceId: dto.serviceId },
        },
      }),
    ]);
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    const duration = staffService?.durationMinutes ?? service.durationMinutes;
    const totalMinutes =
      duration +
      (service.bufferBeforeMinutes ?? 0) +
      (service.bufferAfterMinutes ?? 0);

    const slots = await this.availability.getAvailableSlots(
      dto.staffId,
      dto.date,
      totalMinutes,
    );

    if (!slots.includes(dto.startTime)) {
      throw new BadRequestException('Slot is not available');
    }

    await this.ensureStaffCanPerformService(dto.staffId, dto.serviceId);
  }

  private async ensureStaffCanPerformService(
    staffId: string,
    serviceId: string,
  ) {
    const link = await this.prisma.staffService.findUnique({
      where: { staffId_serviceId: { staffId, serviceId } },
    });
    if (!link) {
      throw new BadRequestException(
        'This staff member does not perform the selected service',
      );
    }
  }

  private async ensureCustomerBelongsToBusiness(
    customerId: string,
    businessId: string,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, businessId, deletedAt: null },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
  }
}
