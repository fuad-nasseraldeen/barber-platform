import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsAggregationService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 1 * * *') // 1 AM daily
  async aggregateDailyStats() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const dayEnd = new Date(yesterday);
    dayEnd.setHours(23, 59, 59, 999);

    const businesses = await this.prisma.business.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    for (const b of businesses) {
      await this.aggregateBusinessDay(b.id, yesterday, dayEnd);
    }
  }

  private async aggregateBusinessDay(
    businessId: string,
    dayStart: Date,
    dayEnd: Date,
  ) {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        businessId,
        startTime: { gte: dayStart, lte: dayEnd },
      },
      include: {
        staff: true,
        service: true,
        payment: true,
      },
    });

    const totalAppointments = appointments.length;
    const completedAppointments = appointments.filter((a) =>
      ['CONFIRMED', 'COMPLETED', 'IN_PROGRESS'].includes(a.status),
    ).length;
    const cancelledAppointments = appointments.filter(
      (a) => a.status === 'CANCELLED',
    ).length;
    const noShowAppointments = appointments.filter(
      (a) => a.status === 'NO_SHOW',
    ).length;

    let totalRevenue = 0;
    for (const a of appointments) {
      if (a.payment?.status === 'SUCCEEDED') {
        totalRevenue += Number(a.payment.amount);
      }
    }

    const newCustomers = await this.prisma.customer.count({
      where: {
        businessId,
        createdAt: { gte: dayStart, lte: dayEnd },
      },
    });

    const waitlistCount = await this.prisma.waitlist.count({
      where: {
        businessId,
        status: 'ACTIVE',
        createdAt: { gte: dayStart, lte: dayEnd },
      },
    });

    await this.prisma.dailyBusinessStats.upsert({
      where: {
        businessId_date: { businessId, date: dayStart },
      },
      create: {
        businessId,
        date: dayStart,
        totalAppointments,
        completedAppointments,
        cancelledAppointments,
        noShowAppointments,
        totalRevenue,
        newCustomers,
        waitlistCount,
      },
      update: {
        totalAppointments,
        completedAppointments,
        cancelledAppointments,
        noShowAppointments,
        totalRevenue,
        newCustomers,
        waitlistCount,
      },
    });

    const byStaff = new Map<
      string,
      { total: number; completed: number; cancelled: number; revenue: number }
    >();
    for (const a of appointments) {
      let entry = byStaff.get(a.staffId);
      if (!entry) {
        entry = { total: 0, completed: 0, cancelled: 0, revenue: 0 };
        byStaff.set(a.staffId, entry);
      }
      entry.total += 1;
      if (['CONFIRMED', 'COMPLETED', 'IN_PROGRESS'].includes(a.status)) {
        entry.completed += 1;
      }
      if (a.status === 'CANCELLED' || a.status === 'NO_SHOW') {
        entry.cancelled += 1;
      }
      if (a.payment?.status === 'SUCCEEDED') {
        entry.revenue += Number(a.payment.amount);
      }
    }

    for (const [staffId, stats] of byStaff) {
      await this.prisma.dailyStaffStats.upsert({
        where: {
          businessId_staffId_date: { businessId, staffId, date: dayStart },
        },
        create: {
          businessId,
          staffId,
          date: dayStart,
          totalBookings: stats.total,
          completedBookings: stats.completed,
          cancelledBookings: stats.cancelled,
          revenue: stats.revenue,
        },
        update: {
          totalBookings: stats.total,
          completedBookings: stats.completed,
          cancelledBookings: stats.cancelled,
          revenue: stats.revenue,
        },
      });
    }

    const byService = new Map<string, { count: number; revenue: number }>();
    for (const a of appointments) {
      if (['CONFIRMED', 'COMPLETED', 'IN_PROGRESS'].includes(a.status)) {
        let entry = byService.get(a.serviceId);
        if (!entry) {
          entry = { count: 0, revenue: 0 };
          byService.set(a.serviceId, entry);
        }
        entry.count += 1;
        if (a.payment?.status === 'SUCCEEDED') {
          entry.revenue += Number(a.payment.amount);
        }
      }
    }

    for (const [serviceId, stats] of byService) {
      await this.prisma.dailyServiceStats.upsert({
        where: {
          businessId_serviceId_date: { businessId, serviceId, date: dayStart },
        },
        create: {
          businessId,
          serviceId,
          date: dayStart,
          bookingCount: stats.count,
          revenue: stats.revenue,
        },
        update: {
          bookingCount: stats.count,
          revenue: stats.revenue,
        },
      });
    }
  }
}
