/**
 * In-memory stub that mimics Redis interface when ENABLE_REDIS=false.
 * No actual Redis connection is made. Used for development without Redis.
 */
export function createRedisStub(): {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: string[]): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<string>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  exists(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  incr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  quit(): Promise<string>;
} {
  const store = new Map<string, { value: string; expiresAt?: number }>();

  return {
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },

    async set(key: string, value: string, ...args: (string | number)[]): Promise<string | null> {
      let expiresAt: number | undefined;
      const exIdx = args.indexOf('EX');
      const nxIdx = args.indexOf('NX');
      if (exIdx >= 0 && args[exIdx + 1] != null) {
        const ttl = Number(args[exIdx + 1]) || 0;
        expiresAt = Date.now() + ttl * 1000;
      }
      if (nxIdx >= 0 && store.has(key)) {
        return null; // NX: do not overwrite
      }
      store.set(key, { value, expiresAt });
      return 'OK';
    },

    async setex(key: string, ttl: number, value: string): Promise<string> {
      const expiresAt = Date.now() + ttl * 1000;
      store.set(key, { value, expiresAt });
      return 'OK';
    },

    async del(...keys: string[]): Promise<number> {
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
      }
      return count;
    },

    async keys(pattern: string): Promise<string[]> {
      const regex = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
      const re = new RegExp(`^${regex}$`);
      return Array.from(store.keys()).filter((k) => re.test(k));
    },

    async exists(...keys: string[]): Promise<number> {
      let count = 0;
      for (const k of keys) {
        const entry = store.get(k);
        if (entry && (!entry.expiresAt || Date.now() <= entry.expiresAt)) count++;
      }
      return count;
    },

    async expire(key: string, seconds: number): Promise<number> {
      const entry = store.get(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    },

    async incr(key: string): Promise<number> {
      const entry = store.get(key);
      const next = entry ? parseInt(entry.value, 10) + 1 : 1;
      store.set(key, { value: String(next) });
      return next;
    },

    async ttl(key: string): Promise<number> {
      const entry = store.get(key);
      if (!entry || !entry.expiresAt) return -2;
      const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    },

    async quit(): Promise<string> {
      store.clear();
      return 'OK';
    },
  };
}
