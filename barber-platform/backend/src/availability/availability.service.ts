import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService, CACHE_TTL } from '../redis/cache.service';
import { SlotLockService } from '../booking/slot-lock.service';
import { AvailabilityWorkerService } from './availability-worker.service';

const SLOT_INTERVAL_MINUTES = 30;

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly slotLock: SlotLockService,
    private readonly config: ConfigService,
    @Optional() private readonly availabilityWorker?: AvailabilityWorkerService,
  ) {}

  /**
   * Get available slots for a staff member on a date.
   * 1. Read from availability cache (precomputed) - queues generation if missing
   * 2. Remove locked slots from Redis
   * 3. Remove slots overlapping with existing appointments
   * 4. Filter to slots that fit service duration (consecutive slots)
   * 5. Return remaining slots
   */
  async getAvailableSlots(
    staffId: string,
    date: string,
    serviceDurationMinutes = SLOT_INTERVAL_MINUTES,
  ): Promise<string[]> {
    const freeSlots = await this.getFreeSlots(staffId, date);

    if (serviceDurationMinutes <= SLOT_INTERVAL_MINUTES) {
      return freeSlots;
    }

    return this.filterSlotsByDuration(freeSlots, serviceDurationMinutes);
  }

  /**
   * Get raw free slots (no duration filtering).
   * 1. Check Redis cache
   * 2. If miss, read from DB (staff_availability_cache)
   * 3. Populate Redis on DB hit
   */
  private async getFreeSlots(staffId: string, date: string): Promise<string[]> {
    const cacheKey = CacheService.keys.availability(staffId, date);

    const fromRedis = await this.cache.get<string[]>(cacheKey);
    if (fromRedis !== null && fromRedis !== undefined && Array.isArray(fromRedis)) {
      const allSlots = fromRedis;
      return this.filterOutBookedAndLocked(staffId, date, allSlots);
    }

    let cached = await this.prisma.staffAvailabilityCache.findUnique({
      where: { staffId_date: { staffId, date: new Date(date) } },
    });

    if (!cached || !Array.isArray(cached.slots)) {
      if (this.availabilityWorker) {
        await this.availabilityWorker.queueAvailabilityGeneration({
          staffId,
          date,
        });
      }
      return [];
    }

    const allSlots = cached.slots as string[];
    await this.cache.set(
      cacheKey,
      allSlots,
      CACHE_TTL.AVAILABILITY,
    );

    return this.filterOutBookedAndLocked(staffId, date, allSlots);

  }

  /**
   * Filter out slots that are locked (Redis) or overlap existing appointments.
   */
  private async filterOutBookedAndLocked(
    staffId: string,
    date: string,
    allSlots: string[],
  ): Promise<string[]> {
    const lockedSlots = await this.slotLock.getLockedSlots(staffId, date);
    const lockedSet = new Set(lockedSlots);

    const dateStart = new Date(`${date}T00:00:00`);
    const dateEnd = new Date(`${date}T23:59:59`);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        staffId,
        startTime: { gte: dateStart, lte: dateEnd },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      select: { startTime: true, endTime: true },
    });

    const bookedSet = new Set<string>();
    for (const apt of appointments) {
      const start = apt.startTime.toISOString().slice(11, 16);
      const end = apt.endTime.toISOString().slice(11, 16);
      for (const slot of allSlots) {
        if (this.slotsOverlap(slot, start, end)) {
          bookedSet.add(slot);
        }
      }
    }

    return allSlots.filter(
      (slot) => !lockedSet.has(slot) && !bookedSet.has(slot),
    );
  }

  private filterSlotsByDuration(
    freeSlots: string[],
    durationMinutes: number,
  ): string[] {
    const sorted = [...freeSlots].sort();
    const slotsNeeded = Math.ceil(durationMinutes / SLOT_INTERVAL_MINUTES);
    const result: string[] = [];

    for (let i = 0; i <= sorted.length - slotsNeeded; i++) {
      const window = sorted.slice(i, i + slotsNeeded);
      if (this.areConsecutive(window)) {
        result.push(window[0]);
      }
    }
    return result;
  }

  private areConsecutive(slots: string[]): boolean {
    for (let i = 1; i < slots.length; i++) {
      const prev = this.toMinutes(slots[i - 1]);
      const curr = this.toMinutes(slots[i]);
      if (curr - prev !== SLOT_INTERVAL_MINUTES) return false;
    }
    return true;
  }

  private toMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  private slotsOverlap(slot: string, aptStart: string, aptEnd: string): boolean {
    const slotStart = this.toMinutes(slot);
    const slotEnd = slotStart + SLOT_INTERVAL_MINUTES;
    const aptStartMin = this.toMinutes(aptStart);
    const aptEndMin = this.toMinutes(aptEnd);
    return slotStart < aptEndMin && slotEnd > aptStartMin;
  }

  /**
   * Check if a date is within the booking window.
   */
  isWithinBookingWindow(dateStr: string): boolean {
    const raw = this.config.get('BOOKING_WINDOW_DAYS', '90');
    const windowDays = parseInt(raw, 10) || 90;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);
    const diffDays = Math.floor(
      (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    return diffDays >= 0 && diffDays <= windowDays;
  }
}
