import { Injectable } from '@nestjs/common';
import { WaitlistStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type AnalyticsFilters = {
  businessId: string;
  branchId?: string;
  staffId?: string;
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private buildAppointmentWhere(
    filters: AnalyticsFilters,
    start: Date,
    end: Date,
    extra?: Record<string, unknown>,
  ) {
    const where: Record<string, unknown> = {
      businessId: filters.businessId,
      startTime: { gte: start, lte: end },
      ...extra,
    };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.staffId) where.staffId = filters.staffId;
    return where;
  }

  private buildVisitWhere(
    filters: AnalyticsFilters,
    start: Date,
    end: Date,
  ) {
    const where: Record<string, unknown> = {
      businessId: filters.businessId,
      status: 'COMPLETED',
      visitDate: { gte: start, lte: end },
    };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.staffId) where.staffId = filters.staffId;
    return where;
  }

  private buildPaymentWhere(
    filters: AnalyticsFilters,
    start: Date,
    end: Date,
  ) {
    const where: Record<string, unknown> = {
      businessId: filters.businessId,
      status: 'SUCCEEDED',
      appointmentId: { not: null },
      createdAt: { gte: start, lte: end },
    };
    if (filters.branchId || filters.staffId) {
      where.appointment = {
        is: {
          ...(filters.branchId && { branchId: filters.branchId }),
          ...(filters.staffId && { staffId: filters.staffId }),
        },
      };
    }
    return where;
  }

  async getAnalytics(
    businessId: string,
    startDate?: string,
    endDate?: string,
    branchId?: string,
    staffId?: string,
  ) {
    const { start, end } = this.getDateRange(startDate, endDate);
    const filters = { businessId, branchId, staffId };

    const [
      revenueByStaff,
      revenueByService,
      customerRetention,
      busyHours,
      dailyBookings,
      staffPerformance,
    ] = await Promise.all([
      this.revenueByStaff(filters, start, end),
      this.revenueByService(filters, start, end),
      this.customerRetention(filters, start, end),
      this.busyHours(filters, start, end),
      this.dailyBookings(filters, start, end),
      this.staffPerformance(filters, start, end),
    ]);

    return {
      period: { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) },
      revenueByStaff,
      revenueByService,
      customerRetention,
      busyHours,
      dailyBookings,
      staffPerformance,
    };
  }

  private getDateRange(startDate?: string, endDate?: string): { start: Date; end: Date } {
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);

    return { start, end };
  }

  private toNumber(d: unknown): number {
    if (typeof d === 'number') return d;
    if (typeof d === 'object' && d !== null && 'toNumber' in d) {
      return (d as { toNumber: () => number }).toNumber();
    }
    return Number(d);
  }

  private async revenueByStaff(
    filters: AnalyticsFilters,
    start: Date,
    end: Date,
  ): Promise<Array<{ staffId: string; staffName: string; revenue: number; count: number }>> {
    const payments = await this.prisma.payment.findMany({
      where: this.buildPaymentWhere(filters, start, end),
      include: {
        appointment: {
          include: { staff: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });

    const byStaff = new Map<string, { name: string; revenue: number; count: number }>();
    for (const p of payments) {
      if (!p.appointment?.staff) continue;
      const staff = p.appointment.staff;
      const existing = byStaff.get(staff.id);
      const amount = this.toNumber(p.amount);
      if (existing) {
        existing.revenue += amount;
        existing.count += 1;
      } else {
        byStaff.set(staff.id, {
          name: `${staff.firstName} ${staff.lastName}`,
          revenue: amount,
          count: 1,
        });
      }
    }

    return Array.from(byStaff.entries()).map(([staffId, v]) => ({
      staffId,
      staffName: v.name,
      revenue: Math.round(v.revenue * 100) / 100,
      count: v.count,
    }));
  }

  private async revenueByService(
    filters: AnalyticsFilters,
    start: Date,
    end: Date,
  ): Promise<Array<{ serviceId: string; serviceName: string; revenue: number; count: number }>> {
    const payments = await this.prisma.payment.findMany({
      where: this.buildPaymentWhere(filters, start, end),
      include: {
        appointment: {
          include: { service: { select: { id: true, name: true } } },
        },
      },
    });

    const byService = new Map<string, { name: string; revenue: number; count: number }>();
    for (const p of payments) {
      if (!p.appointment?.service) continue;
      const svc = p.appointment.service;
      const existing = byService.get(svc.id);
      const amount = this.toNumber(p.amount);
      if (existing) {
        existing.revenue += amount;
        existing.count += 1;
      } else {
        byService.set(svc.id, {
          name: svc.name,
          revenue: amount,
          count: 1,
        });
      }
    }

    return Array.from(byService.entries()).map(([serviceId, v]) => ({
      serviceId,
      serviceName: v.name,
      revenue: Math.round(v.revenue * 100) / 100,
      count: v.count,
    }));
  }

  private async customerRetention(
    filters: AnalyticsFilters,
    start: Date,
    end: Date,
  ): Promise<{
    totalCustomers: number;
    repeatCustomers: number;
    retentionRate: number;
    newCustomers: number;
  }> {
    const appointments = await this.prisma.appointment.findMany({
      where: this.buildAppointmentWhere(filters, start, end, {
        status: { in: ['CONFIRMED', 'COMPLETED', 'IN_PROGRESS'] },
      }),
      select: { customerId: true },
    });

    const countByCustomer = new Map<string, number>();
    for (const a of appointments) {
      countByCustomer.set(a.customerId, (countByCustomer.get(a.customerId) ?? 0) + 1);
    }

    const totalCustomers = countByCustomer.size;
    const repeatCustomers = Array.from(countByCustomer.values()).filter((c) => c > 1).length;
    const retentionRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;
    const newCustomers = totalCustomers - repeatCustomers;

    return {
      totalCustomers,
      repeatCustomers,
      retentionRate: Math.round(retentionRate * 100) / 100,
      newCustomers,
    };
  }

  private async busyHours(
    filters: AnalyticsFilters,
    start: Date,
    end: Date,
  ): Promise<Array<{ hour: number; count: number }>> {
    const appointments = await this.prisma.appointment.findMany({
      where: this.buildAppointmentWhere(filters, start, end, {
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      }),
      select: { startTime: true },
    });

    const byHour = new Map<number, number>();
    for (let h = 0; h < 24; h++) byHour.set(h, 0);

    for (const a of appointments) {
      const hour = a.startTime.getHours();
      byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
    }

    return Array.from(byHour.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour);
  }

  private async dailyBookings(
    filters: AnalyticsFilters,
    start: Date,
    end: Date,
  ): Promise<Array<{ date: string; count: number }>> {
    const appointments = await this.prisma.appointment.findMany({
      where: this.buildAppointmentWhere(filters, start, end, {
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      }),
      select: { startTime: true },
    });

    const byDate = new Map<string, number>();
    for (const a of appointments) {
      const dateStr = a.startTime.toISOString().slice(0, 10);
      byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + 1);
    }

    return Array.from(byDate.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private async staffPerformance(
    filters: AnalyticsFilters,
    start: Date,
    end: Date,
  ): Promise<
    Array<{
      staffId: string;
      staffName: string;
      totalBookings: number;
      completedBookings: number;
      cancelledBookings: number;
      revenue: number;
      completionRate: number;
    }>
  > {
    const appointments = await this.prisma.appointment.findMany({
      where: this.buildAppointmentWhere(filters, start, end),
      include: {
        staff: { select: { id: true, firstName: true, lastName: true } },
        payment: true,
      },
    });

    const byStaff = new Map<
      string,
      {
        name: string;
        total: number;
        completed: number;
        cancelled: number;
        revenue: number;
      }
    >();

    for (const a of appointments) {
      const staff = a.staff;
      let entry = byStaff.get(staff.id);
      if (!entry) {
        entry = {
          name: `${staff.firstName} ${staff.lastName}`,
          total: 0,
          completed: 0,
          cancelled: 0,
          revenue: 0,
        };
        byStaff.set(staff.id, entry);
      }

      entry.total += 1;
      if (a.status === 'COMPLETED' || a.status === 'CONFIRMED' || a.status === 'IN_PROGRESS') {
        entry.completed += 1;
      }
      if (a.status === 'CANCELLED' || a.status === 'NO_SHOW') {
        entry.cancelled += 1;
      }
      if (a.payment?.status === 'SUCCEEDED') {
        entry.revenue += this.toNumber(a.payment.amount);
      }
    }

    return Array.from(byStaff.entries()).map(([staffId, v]) => ({
      staffId,
      staffName: v.name,
      totalBookings: v.total,
      completedBookings: v.completed,
      cancelledBookings: v.cancelled,
      revenue: Math.round(v.revenue * 100) / 100,
      completionRate: v.total > 0 ? Math.round((v.completed / v.total) * 10000) / 100 : 0,
    }));
  }

  async getDashboard(businessId: string, branchId?: string) {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    weekAgo.setHours(0, 0, 0, 0);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    monthAgo.setHours(0, 0, 0, 0);

    const filters: AnalyticsFilters = { businessId, branchId };

    const [
      customerGrowth,
      appointmentsGraph,
      waitlistToday,
      staffPerformance,
      recentActivity,
      visitMetrics,
      todayMetrics,
      todaysBirthdays,
    ] = await Promise.all([
      this.getCustomerGrowth(businessId, branchId, monthAgo, now),
      this.getAppointmentsGraph(filters, weekAgo, now),
      this.getWaitlistToday(businessId, branchId),
      this.staffPerformance(filters, monthAgo, now),
      this.getRecentActivity(filters, weekAgo, now),
      this.getVisitMetrics(filters, monthAgo, now),
      this.getTodayMetrics(filters, todayStart, todayEnd),
      this.getTodaysBirthdays(businessId, branchId, now),
    ]);

    return {
      customerGrowth,
      appointmentsGraph,
      waitlistToday,
      staffPerformance,
      recentActivity,
      visitMetrics,
      todayMetrics,
      todaysBirthdays,
    };
  }

  private async getCustomerGrowth(
    businessId: string,
    branchId: string | undefined,
    start: Date,
    end: Date,
  ) {
    const where: { businessId: string; createdAt: { gte: Date; lte: Date }; branchId?: string } = {
      businessId,
      createdAt: { gte: start, lte: end },
    };
    if (branchId) where.branchId = branchId;

    const customers = await this.prisma.customer.findMany({
      where,
      select: { createdAt: true },
    });

    const byWeek = new Map<string, number>();
    for (const c of customers) {
      const weekStart = new Date(c.createdAt);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const key = weekStart.toISOString().slice(0, 10);
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
    }

    return Array.from(byWeek.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private async getAppointmentsGraph(
    filters: AnalyticsFilters,
    start: Date,
    end: Date,
  ) {
    return this.dailyBookings(filters, start, end);
  }

  private async getWaitlistToday(businessId: string, branchId?: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const where = {
      businessId,
      status: WaitlistStatus.ACTIVE,
      ...(branchId && { branchId }),
    };

    const count = await this.prisma.waitlist.count({ where });
    return { count };
  }

  private async getTodayMetrics(
    filters: AnalyticsFilters,
    todayStart: Date,
    todayEnd: Date,
  ): Promise<{
    appointmentsToday: number;
    customersToday: number;
    revenueToday: number;
    waitlistSize: number;
  }> {
    const [appointments, customers, payments, waitlist] = await Promise.all([
      this.prisma.appointment.count({
        where: this.buildAppointmentWhere(filters, todayStart, todayEnd, {
          status: { notIn: ['CANCELLED'] },
        }),
      }),
      this.prisma.customer.count({
        where: {
          businessId: filters.businessId,
          createdAt: { gte: todayStart, lte: todayEnd },
          ...(filters.branchId && { branchId: filters.branchId }),
        },
      }),
      this.prisma.payment.aggregate({
        where: this.buildPaymentWhere(filters, todayStart, todayEnd),
        _sum: { amount: true },
      }),
      this.prisma.waitlist.count({
        where: {
          businessId: filters.businessId,
          status: WaitlistStatus.ACTIVE,
          ...(filters.branchId && { branchId: filters.branchId }),
        },
      }),
    ]);

    const revenue = payments._sum.amount
      ? this.toNumber(payments._sum.amount)
      : 0;

    return {
      appointmentsToday: appointments,
      customersToday: customers,
      revenueToday: Math.round(revenue * 100) / 100,
      waitlistSize: waitlist,
    };
  }

  private async getVisitMetrics(
    filters: AnalyticsFilters,
    start: Date,
    end: Date,
  ): Promise<{
    returningCustomers: number;
    avgVisitsPerCustomer: number;
    customerRetentionRate: number;
  }> {
    const visits = await this.prisma.customerVisit.findMany({
      where: this.buildVisitWhere(filters, start, end),
      select: { customerId: true },
    });

    const countByCustomer = new Map<string, number>();
    for (const v of visits) {
      countByCustomer.set(v.customerId, (countByCustomer.get(v.customerId) ?? 0) + 1);
    }

    const totalCustomers = countByCustomer.size;
    const returningCustomers = Array.from(countByCustomer.values()).filter((c) => c >= 2).length;
    const totalVisits = visits.length;
    const avgVisitsPerCustomer =
      totalCustomers > 0 ? Math.round((totalVisits / totalCustomers) * 100) / 100 : 0;
    const customerRetentionRate =
      totalCustomers > 0 ? Math.round((returningCustomers / totalCustomers) * 10000) / 100 : 0;

    return {
      returningCustomers,
      avgVisitsPerCustomer,
      customerRetentionRate,
    };
  }

  private async getTodaysBirthdays(
    businessId: string,
    branchId: string | undefined,
    now: Date,
  ): Promise<Array<{ id: string; name: string; type: 'customer' }>> {
    const month = now.getMonth() + 1;
    const day = now.getDate();

    const where: { businessId: string; birthDate: { not: null }; branchId?: string } = {
      businessId,
      birthDate: { not: null },
    };
    if (branchId) where.branchId = branchId;

    const customers = await this.prisma.customer.findMany({
      where,
      select: { id: true, firstName: true, lastName: true, birthDate: true },
    });

    const result: Array<{ id: string; name: string; type: 'customer' }> = [];
    for (const c of customers) {
      if (!c.birthDate) continue;
      const bd = new Date(c.birthDate);
      if (bd.getMonth() + 1 === month && bd.getDate() === day) {
        const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Customer';
        result.push({ id: c.id, name, type: 'customer' });
      }
    }
    return result;
  }

  private async getRecentActivity(
    filters: AnalyticsFilters,
    start: Date,
    end: Date,
  ) {
    const aptWhere = this.buildAppointmentWhere(filters, start, end);
    const appointments = await this.prisma.appointment.findMany({
      where: aptWhere,
      include: {
        staff: { select: { firstName: true, lastName: true } },
        customer: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 15,
    });

    const custWhere: { businessId: string; createdAt: { gte: Date; lte: Date }; branchId?: string } = {
      businessId: filters.businessId,
      createdAt: { gte: start, lte: end },
    };
    if (filters.branchId) custWhere.branchId = filters.branchId;

    const newCustomers = await this.prisma.customer.findMany({
      where: custWhere,
      select: { id: true, firstName: true, lastName: true, email: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const aptActivities = appointments.map((a) => ({
      id: a.id,
      type: a.status === 'CANCELLED' ? 'cancellation' : a.status === 'NO_SHOW' ? 'no_show' : 'booking',
      staffName: `${a.staff.firstName} ${a.staff.lastName}`,
      customerName: `${a.customer.firstName ?? ''} ${a.customer.lastName ?? ''}`.trim() || 'Customer',
      serviceName: a.service.name,
      status: a.status,
      startTime: a.startTime,
      createdAt: a.updatedAt,
    }));

    const custActivities = newCustomers.map((c) => ({
      id: c.id,
      type: 'customer_registered' as const,
      customerName: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.email,
      createdAt: c.createdAt,
    }));

    const combined = [...aptActivities, ...custActivities]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);

    return combined;
  }
}
