import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

/** TTL in seconds */
export const CACHE_TTL = {
  BUSINESS: 600,      // 10 min
  STAFF_LIST: 300,    // 5 min
  SERVICES_LIST: 300, // 5 min
  APPOINTMENTS_DAY: 60, // 1 min
  AVAILABILITY: 60,   // 1 min
  SLOT_LOCK: 600,     // 10 min (booking lock)
  WAITLIST_RESERVE: 900, // 15 min (waitlist slot reserve)
} as const;

@Injectable()
export class CacheService {
  constructor(private readonly redis: RedisService) {}

  private get client() {
    return this.redis.getClient();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as T;
      }
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
    } catch {
      // Redis unavailable - skip cache
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      // Redis unavailable
    }
  }

  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch {
      // Redis unavailable
    }
  }

  async invalidateBusiness(businessId: string): Promise<void> {
    try {
      await Promise.all([
        this.del(`business:id:${businessId}`),
        this.delPattern(`staff:list:${businessId}*`),
        this.delPattern(`services:list:${businessId}*`),
        this.delPattern(`appointments:*:${businessId}*`),
      ]);
    } catch {
      // Redis unavailable
    }
  }

  async invalidateBusinessBySlug(slug: string): Promise<void> {
    try {
      await this.del(`business:${slug}`);
    } catch {
      // Redis unavailable
    }
  }

  async invalidateStaff(staffId: string): Promise<void> {
    try {
      await this.delPattern(`availability:*:${staffId}:*`);
      await this.delPattern(`appointments:day:${staffId}:*`);
    } catch {
      // Redis unavailable
    }
  }

  async invalidateAvailability(staffId: string, date?: string): Promise<void> {
    try {
      if (date) {
        await this.del(`availability:${staffId}:${date}`);
        await this.del(`appointments:day:${staffId}:${date}`);
      } else {
        await this.delPattern(`availability:${staffId}:*`);
        await this.delPattern(`appointments:day:${staffId}:*`);
      }
    } catch {
      // Redis unavailable
    }
  }

  // --- Cache key builders ---

  static keys = {
    business: (slug: string) => `business:${slug}`,
    businessById: (id: string) => `business:id:${id}`,
    staffList: (businessId: string, branchId?: string, excludeManagers?: boolean) =>
      `staff:list:${businessId}:${branchId ?? 'all'}:${excludeManagers ? 'no-mgrs' : 'all'}`,
    servicesList: (businessId: string) => `services:list:${businessId}`,
    appointmentsDay: (staffId: string, date: string) =>
      `appointments:day:${staffId}:${date}`,
    availability: (staffId: string, date: string) =>
      `availability:${staffId}:${date}`,
    slotLock: (staffId: string, date: string, time: string) =>
      `lock:slot:${staffId}:${date}:${time}`,
  };
}
