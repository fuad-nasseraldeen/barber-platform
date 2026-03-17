import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { CacheService, CACHE_TTL } from '../redis/cache.service';

@Injectable()
export class SlotLockService {
  constructor(
    private readonly redis: RedisService,
    private readonly cache: CacheService,
  ) {}

  private get client() {
    return this.redis.getClient();
  }

  /**
   * Acquire a distributed lock for a slot.
   * Returns true if lock acquired, false if slot is already locked.
   */
  async acquireLock(
    staffId: string,
    date: string,
    time: string,
    sessionId?: string,
    ttlSeconds: number = CACHE_TTL.SLOT_LOCK,
  ): Promise<boolean> {
    const key = CacheService.keys.slotLock(staffId, date, time);
    const value = sessionId ?? `lock:${Date.now()}`;
    const result = await this.client.set(
      key,
      value,
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /**
   * Release a slot lock (e.g., when booking is confirmed or user abandons).
   */
  async releaseLock(staffId: string, date: string, time: string): Promise<void> {
    const key = CacheService.keys.slotLock(staffId, date, time);
    await this.client.del(key);
  }

  /**
   * Check if a slot is locked.
   */
  async isLocked(staffId: string, date: string, time: string): Promise<boolean> {
    const key = CacheService.keys.slotLock(staffId, date, time);
    const exists = await this.client.exists(key);
    return exists === 1;
  }

  /**
   * Get all locked slots for a staff member on a date.
   * Used when filtering availability.
   */
  async getLockedSlots(staffId: string, date: string): Promise<string[]> {
    const pattern = `lock:slot:${staffId}:${date}:*`;
    const keys = await this.client.keys(pattern);
    return keys.map((k) => k.split(':').pop() ?? '');
  }

  /**
   * Extend lock TTL when user is in checkout (optional).
   */
  async extendLock(
    staffId: string,
    date: string,
    time: string,
    ttlSeconds = CACHE_TTL.SLOT_LOCK,
  ): Promise<boolean> {
    const key = CacheService.keys.slotLock(staffId, date, time);
    const result = await this.client.expire(key, ttlSeconds);
    return result === 1;
  }

  /**
   * Acquire locks for all slots covered by a service duration.
   * Uses 30-min slot granularity. Returns true only if ALL slots were locked.
   * On failure, releases any already-acquired locks.
   */
  async acquireLockForDuration(
    staffId: string,
    date: string,
    startTime: string,
    durationMinutes: number,
    sessionId?: string,
    ttlSeconds: number = CACHE_TTL.SLOT_LOCK,
  ): Promise<{ success: boolean; sessionId: string }> {
    const slots = this.getSlotsForDuration(startTime, durationMinutes);
    const session = sessionId ?? `lock:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    const acquired: string[] = [];
    for (const slot of slots) {
      const ok = await this.acquireLock(staffId, date, slot, session, ttlSeconds);
      if (!ok) {
        for (const s of acquired) {
          await this.releaseLock(staffId, date, s);
        }
        return { success: false, sessionId: session };
      }
      acquired.push(slot);
    }
    return { success: true, sessionId: session };
  }

  /**
   * Release all locks for a service duration.
   */
  async releaseLockForDuration(
    staffId: string,
    date: string,
    startTime: string,
    durationMinutes: number,
  ): Promise<void> {
    const slots = this.getSlotsForDuration(startTime, durationMinutes);
    for (const slot of slots) {
      await this.releaseLock(staffId, date, slot);
    }
  }

  /**
   * Verify that the current session holds the lock for the given slot.
   */
  async verifyLock(
    staffId: string,
    date: string,
    time: string,
    sessionId: string,
  ): Promise<boolean> {
    const key = CacheService.keys.slotLock(staffId, date, time);
    const value = await this.client.get(key);
    return value === sessionId;
  }

  /**
   * Verify session holds locks for all slots in duration.
   */
  async verifyLockForDuration(
    staffId: string,
    date: string,
    startTime: string,
    durationMinutes: number,
    sessionId: string,
  ): Promise<boolean> {
    const slots = this.getSlotsForDuration(startTime, durationMinutes);
    for (const slot of slots) {
      const ok = await this.verifyLock(staffId, date, slot, sessionId);
      if (!ok) return false;
    }
    return true;
  }

  private getSlotsForDuration(
    startTime: string,
    durationMinutes: number,
  ): string[] {
    const [h, m] = startTime.split(':').map(Number);
    let currentMinutes = h * 60 + m;
    const endMinutes = currentMinutes + durationMinutes;
    const slots: string[] = [];
    const interval = 30;

    while (currentMinutes < endMinutes) {
      const sh = Math.floor(currentMinutes / 60);
      const sm = currentMinutes % 60;
      slots.push(
        `${sh.toString().padStart(2, '0')}:${sm.toString().padStart(2, '0')}`,
      );
      currentMinutes += interval;
    }
    return slots;
  }
}
