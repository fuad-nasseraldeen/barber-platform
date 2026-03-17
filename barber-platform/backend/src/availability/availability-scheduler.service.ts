import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityWorkerService } from './availability-worker.service';

/**
 * Daily precompute of staff availability.
 * Runs at 00:05 every day and queues availability generation for all active staff
 * for the next BOOKING_WINDOW_DAYS.
 */
@Injectable()
export class AvailabilitySchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly worker: AvailabilityWorkerService,
    private readonly config: ConfigService,
  ) {}

  @Cron('5 0 * * *', {
    name: 'availability-daily-precompute',
    timeZone: 'UTC',
  })
  async handleDailyPrecompute() {
    const windowDays = this.getBookingWindowDays();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const staffList = await this.prisma.staff.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });

    const dateStrings: string[] = [];
    for (let d = 0; d < windowDays; d++) {
      const dte = new Date(today);
      dte.setDate(dte.getDate() + d);
      dateStrings.push(dte.toISOString().slice(0, 10));
    }

    let queued = 0;
    for (const staff of staffList) {
      await this.worker.queueForStaffAndDates(staff.id, dateStrings);
      queued += dateStrings.length;
    }

    // Log for observability (optional: use Logger)
    if (staffList.length > 0) {
      console.log(
        `[AvailabilityScheduler] Queued ${queued} jobs for ${staffList.length} staff`,
      );
    }
  }

  /**
   * Manual trigger for precompute (e.g. from admin API or on app bootstrap).
   */
  async triggerPrecomputeNow(): Promise<{ staffCount: number; datesCount: number }> {
    const windowDays = this.getBookingWindowDays();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const staffList = await this.prisma.staff.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });

    const dateStrings: string[] = [];
    for (let d = 0; d < windowDays; d++) {
      const dte = new Date(today);
      dte.setDate(dte.getDate() + d);
      dateStrings.push(dte.toISOString().slice(0, 10));
    }

    for (const staff of staffList) {
      await this.worker.queueForStaffAndDates(staff.id, dateStrings);
    }

    return { staffCount: staffList.length, datesCount: dateStrings.length };
  }

  private getBookingWindowDays(): number {
    const raw = this.config.get('BOOKING_WINDOW_DAYS', '90');
    return parseInt(raw, 10) || 90;
  }
}
