/**
 * In-memory stub that mimics Redis interface when ENABLE_REDIS=false.
 * No actual Redis connection is made. Used for development without Redis.
 */
export function createRedisStub(): {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: string[]): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<string>;
  del(...keys: string[]): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, ...args: string[]): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  exists(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  zadd(key: string, ...args: string[]): Promise<number>;
  zrangebyscore(
    key: string,
    min: string,
    max: string,
    ...args: string[]
  ): Promise<string[]>;
  zrem(key: string, ...members: string[]): Promise<number>;
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

    async hgetall(key: string): Promise<Record<string, string>> {
      const entry = store.get(key);
      if (!entry) return {};
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key);
        return {};
      }
      try {
        const parsed = JSON.parse(entry.value) as Record<string, string>;
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    },

    async hset(key: string, ...args: string[]): Promise<number> {
      const entry = store.get(key);
      let parsed: Record<string, string> = {};
      if (entry && (!entry.expiresAt || Date.now() <= entry.expiresAt)) {
        try {
          parsed = JSON.parse(entry.value) as Record<string, string>;
        } catch {
          parsed = {};
        }
      }
      let added = 0;
      for (let i = 0; i < args.length; i += 2) {
        const field = args[i];
        const value = args[i + 1];
        if (!(field in parsed)) added++;
        parsed[field] = value;
      }
      store.set(key, {
        value: JSON.stringify(parsed),
        expiresAt: entry?.expiresAt,
      });
      return added;
    },

    async hdel(key: string, ...fields: string[]): Promise<number> {
      const entry = store.get(key);
      if (!entry) return 0;
      let parsed: Record<string, string> = {};
      try {
        parsed = JSON.parse(entry.value) as Record<string, string>;
      } catch {
        return 0;
      }
      let removed = 0;
      for (const field of fields) {
        if (field in parsed) {
          delete parsed[field];
          removed++;
        }
      }
      store.set(key, {
        value: JSON.stringify(parsed),
        expiresAt: entry.expiresAt,
      });
      return removed;
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

    async decr(key: string): Promise<number> {
      const entry = store.get(key);
      const next = entry ? parseInt(entry.value, 10) - 1 : -1;
      store.set(key, { value: String(next) });
      return next;
    },

    async ttl(key: string): Promise<number> {
      const entry = store.get(key);
      if (!entry || !entry.expiresAt) return -2;
      const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    },

    async zadd(key: string, ...args: string[]): Promise<number> {
      const entry = store.get(key);
      let parsed: Array<{ score: number; member: string }> = [];
      if (entry && (!entry.expiresAt || Date.now() <= entry.expiresAt)) {
        try {
          parsed = JSON.parse(entry.value) as Array<{ score: number; member: string }>;
        } catch {
          parsed = [];
        }
      }
      let added = 0;
      for (let i = 0; i < args.length; i += 2) {
        const score = Number(args[i]);
        const member = args[i + 1];
        const idx = parsed.findIndex((v) => v.member === member);
        if (idx >= 0) {
          parsed[idx] = { score, member };
        } else {
          parsed.push({ score, member });
          added++;
        }
      }
      store.set(key, {
        value: JSON.stringify(parsed),
        expiresAt: entry?.expiresAt,
      });
      return added;
    },

    async zrangebyscore(
      key: string,
      min: string,
      max: string,
      ...args: string[]
    ): Promise<string[]> {
      const entry = store.get(key);
      if (!entry) return [];
      let parsed: Array<{ score: number; member: string }> = [];
      try {
        parsed = JSON.parse(entry.value) as Array<{ score: number; member: string }>;
      } catch {
        return [];
      }
      const minScore = min === '-inf' ? Number.NEGATIVE_INFINITY : Number(min);
      const maxScore = max === '+inf' ? Number.POSITIVE_INFINITY : Number(max);
      const filtered = parsed
        .filter((v) => v.score >= minScore && v.score <= maxScore)
        .sort((a, b) => a.score - b.score);
      const limitIdx = args.indexOf('LIMIT');
      if (limitIdx >= 0) {
        const offset = Number(args[limitIdx + 1]) || 0;
        const count = Number(args[limitIdx + 2]) || filtered.length;
        return filtered.slice(offset, offset + count).map((v) => v.member);
      }
      return filtered.map((v) => v.member);
    },

    async zrem(key: string, ...members: string[]): Promise<number> {
      const entry = store.get(key);
      if (!entry) return 0;
      let parsed: Array<{ score: number; member: string }> = [];
      try {
        parsed = JSON.parse(entry.value) as Array<{ score: number; member: string }>;
      } catch {
        return 0;
      }
      const before = parsed.length;
      const next = parsed.filter((v) => !members.includes(v.member));
      store.set(key, {
        value: JSON.stringify(next),
        expiresAt: entry.expiresAt,
      });
      return before - next.length;
    },

    async quit(): Promise<string> {
      store.clear();
      return 'OK';
    },
  };
}
