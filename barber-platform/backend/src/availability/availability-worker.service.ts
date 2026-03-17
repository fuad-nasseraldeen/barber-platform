import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { Queue, Worker, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { enableRedis } from '../common/redis-config';

export interface AvailabilityJobData {
  staffId: string;
  date: string;
  dates?: string[];
}

@Injectable()
export class AvailabilityWorkerService {
  private availabilityQueue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {
    if (!enableRedis) {
      return;
    }

    const connection = this.getConnection();
    this.availabilityQueue = new Queue('availability', { connection });

    const enableWorkers = this.config.get('ENABLE_QUEUE_WORKERS', 'true') !== 'false';
    if (enableWorkers) {
      this.worker = new Worker(
        'availability',
        this.processJob.bind(this),
        { connection, concurrency: 5 },
      );
    }
  }

  private getConnection() {
    const url = this.config.get('REDIS_URL');
    if (url) return { url, retryStrategy: () => null };
    return {
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD') || undefined,
      retryStrategy: () => null,
    };
  }

  async queueAvailabilityGeneration(data: AvailabilityJobData): Promise<void> {
    if (!enableRedis) {
      // Run synchronously when Redis disabled - availability still works
      await this.processJob({ data } as Job<AvailabilityJobData>);
      return;
    }
    if (this.availabilityQueue) {
      await this.availabilityQueue.add('generate', data, {
        jobId: `${data.staffId}:${data.date}`,
        removeOnComplete: { count: 1000 },
      });
    }
  }

  async queueForStaffAndDates(
    staffId: string,
    dates: string[],
  ): Promise<void> {
    for (const date of dates) {
      await this.queueAvailabilityGeneration({ staffId, date });
    }
  }

  /**
   * Invalidate cache and queue regeneration for a staff member for the next N days.
   * Call when working hours, breaks, or time off change.
   * Deletes DB cache rows so stale availability (e.g. before approved vacation) is not served.
   */
  async invalidateAndQueueForStaff(
    staffId: string,
    windowDays: number,
  ): Promise<void> {
    await this.cache.invalidateAvailability(staffId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dates: string[] = [];
    for (let d = 0; d < windowDays; d++) {
      const dte = new Date(today);
      dte.setDate(dte.getDate() + d);
      dates.push(dte.toISOString().slice(0, 10));
    }

    if (dates.length > 0) {
      // Delete stale DB cache so next request triggers correct regeneration (avoids serving old slots during vacation)
      await this.prisma.staffAvailabilityCache.deleteMany({
        where: {
          staffId,
          date: {
            gte: new Date(dates[0]),
            lte: new Date(dates[dates.length - 1]),
          },
        },
      });
      // When Redis disabled: skip sync regeneration of 90 days (was ~12s). Regeneration happens on-demand per date.
      if (enableRedis && this.availabilityQueue) {
        await this.queueForStaffAndDates(staffId, dates);
      }
    }
  }

  private async processJob(job: Job<AvailabilityJobData>): Promise<void> {
    const { staffId, date } = job.data;
    const slots = await this.computeSlots(staffId, date);
    await this.prisma.staffAvailabilityCache.upsert({
      where: { staffId_date: { staffId, date: new Date(date) } },
      create: { staffId, date: new Date(date), slots },
      update: { slots, generatedAt: new Date() },
    });
    await this.cache.invalidateAvailability(staffId, date);
  }

  private async computeSlots(staffId: string, dateStr: string): Promise<string[]> {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();

    const workingHours = await this.prisma.staffWorkingHours.findFirst({
      where: { staffId, dayOfWeek },
    });
    if (!workingHours) return [];

    const [weeklyBreaks, dateBreaks] = await Promise.all([
      this.prisma.staffBreak.findMany({
        where: { staffId, dayOfWeek },
      }),
      this.prisma.staffBreakException.findMany({
        where: { staffId, date },
      }),
    ]);
    const breaks = [
      ...weeklyBreaks,
      ...dateBreaks.map((b) => ({ startTime: b.startTime, endTime: b.endTime })),
    ];

    const timeOff = await this.prisma.staffTimeOff.findFirst({
      where: {
        staffId,
        status: 'APPROVED',
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
    if (timeOff) return [];

    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId },
    });
    if (!staff) return [];

    const holiday = await this.findHolidayForDate(
      staff.businessId,
      date,
    );
    if (holiday) return [];

    const slots: string[] = [];
    const [startH, startM] = workingHours.startTime.split(':').map(Number);
    const [endH, endM] = workingHours.endTime.split(':').map(Number);
    let currentMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const interval = 30;

    while (currentMinutes + interval <= endMinutes) {
      const h = Math.floor(currentMinutes / 60);
      const m = currentMinutes % 60;
      const slot = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

      const slotEndMinutes = currentMinutes + interval;
      const inBreak = breaks.some((b) => {
        const [bStartH, bStartM] = b.startTime.split(':').map(Number);
        const [bEndH, bEndM] = b.endTime.split(':').map(Number);
        const bStart = bStartH * 60 + bStartM;
        const bEnd = bEndH * 60 + bEndM;
        return currentMinutes < bEnd && slotEndMinutes > bStart;
      });
      if (!inBreak) slots.push(slot);

      currentMinutes += interval;
    }

    return slots;
  }

  /**
   * Check if a holiday applies to the given date.
   * Handles recurring holidays (e.g. Christmas) by matching month/day.
   */
  private async findHolidayForDate(
    businessId: string,
    date: Date,
  ): Promise<{ id: string } | null> {
    const targetMonth = date.getMonth();
    const targetDay = date.getDate();

    const holidays = await this.prisma.businessHoliday.findMany({
      where: { businessId },
      select: { id: true, date: true, isRecurring: true },
    });

    for (const h of holidays) {
      if (h.isRecurring) {
        const hDate = new Date(h.date);
        if (hDate.getMonth() === targetMonth && hDate.getDate() === targetDay) {
          return { id: h.id };
        }
      } else {
        const hDate = new Date(h.date);
        hDate.setHours(0, 0, 0, 0);
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        if (hDate.getTime() === d.getTime()) {
          return { id: h.id };
        }
      }
    }
    return null;
  }

  async onModuleDestroy() {
    if (this.worker) await this.worker.close();
    if (this.availabilityQueue) await this.availabilityQueue.close();
  }
}
