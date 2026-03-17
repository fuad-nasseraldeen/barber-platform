/**
 * In-memory OTP store for development when Redis is unavailable.
 * Set OTP_USE_MEMORY_STORE=true in .env to use this instead of Redis.
 */

interface TtlEntry {
  value: string;
  expiresAt: number;
}

interface CounterEntry {
  count: number;
  expiresAt: number;
}

export class OtpMemoryStore {
  private store = new Map<string, TtlEntry | CounterEntry>();

  async get(key: string): Promise<string | null> {
    this.cleanExpired();
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) return null;
    if ('value' in entry) return entry.value;
    if ('count' in entry) return String(entry.count);
    return null;
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async incr(key: string): Promise<number> {
    const entry = this.store.get(key) as CounterEntry | undefined;
    const count = entry && 'count' in entry ? entry.count + 1 : 1;
    const isRateLimit = key.startsWith('otp:ratelimit:');
    const ttlSeconds = isRateLimit ? 900 : 300;
    const expiresAt =
      entry && 'expiresAt' in entry && entry.expiresAt > Date.now()
        ? entry.expiresAt
        : Date.now() + ttlSeconds * 1000;
    this.store.set(key, { count, expiresAt });
    return count;
  }

  async expire(_key: string, _seconds: number): Promise<void> {
    // TTL set in incr
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key) as CounterEntry | undefined;
    if (!entry || !('expiresAt' in entry)) return -1;
    const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -1;
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if ('expiresAt' in v && v.expiresAt < now) this.store.delete(k);
    }
  }
}
