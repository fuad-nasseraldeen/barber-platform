import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerVisitStatus } from '@prisma/client';

@Injectable()
export class CustomerVisitsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a customer visit when an appointment reaches a final status.
   * Call when status changes to COMPLETED, NO_SHOW, or CANCELLED.
   */
  async createFromAppointment(
    appointmentId: string,
    status: 'COMPLETED' | 'NO_SHOW' | 'CANCELLED',
    price: number,
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        service: { select: { price: true } },
      },
    });

    if (!appointment) return null;

    const existing = await this.prisma.customerVisit.findUnique({
      where: { appointmentId },
    });
    if (existing) return existing;

    const visitStatus: CustomerVisitStatus =
      status === 'COMPLETED' ? 'COMPLETED' : status === 'NO_SHOW' ? 'NO_SHOW' : 'CANCELLED';
    const visitPrice = status === 'COMPLETED' ? price : 0;

    return this.prisma.customerVisit.create({
      data: {
        businessId: appointment.businessId,
        branchId: appointment.branchId,
        customerId: appointment.customerId,
        staffId: appointment.staffId,
        serviceId: appointment.serviceId,
        appointmentId: appointment.id,
        visitDate: appointment.startTime,
        status: visitStatus,
        price: visitPrice,
      },
    });
  }

  async findByCustomer(customerId: string, businessId: string, limit = 50) {
    return this.prisma.customerVisit.findMany({
      where: { customerId, businessId },
      include: {
        staff: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
      },
      orderBy: { visitDate: 'desc' },
      take: limit,
    });
  }

  /**
   * Get stats for automation rules.
   */
  async getCustomerVisitStats(customerId: string, businessId: string) {
    const visits = await this.prisma.customerVisit.findMany({
      where: { customerId, businessId },
      select: { status: true, visitDate: true },
      orderBy: { visitDate: 'desc' },
    });

    const noShowCount = visits.filter((v) => v.status === 'NO_SHOW').length;
    const lastVisit = visits.find((v) => v.status === 'COMPLETED');
    const completedVisits = visits.filter((v) => v.status === 'COMPLETED');

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const visitsLast30Days = completedVisits.filter(
      (v) => v.visitDate >= thirtyDaysAgo,
    ).length;
    const visitFrequency = visitsLast30Days > 0 ? visitsLast30Days / 30 : 0;

    return {
      customerNoShowCount: noShowCount,
      lastVisitDate: lastVisit?.visitDate ?? null,
      totalCompletedVisits: completedVisits.length,
      visitFrequencyPerDay: Math.round(visitFrequency * 100) / 100,
    };
  }
}
