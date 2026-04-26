import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { enableRedis, requireRedisInProduction } from '../common/redis-config';
import { logRedisConnectionConfig, resolveRedisConnection } from '../common/redis-connection';
import { createRedisStub } from './redis-stub';

export type RedisDiagnostics = {
  enableRedisFlag: boolean;
  mode: 'off' | 'stub' | 'live';
  ping: 'ok' | 'error' | 'skipped';
  pingMs?: number;
  error?: string;
};

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | ReturnType<typeof createRedisStub>;
  private errorLogged = false;
  private isStub = false;

  constructor(private config: ConfigService) {
    if (!enableRedis) {
      this.client = createRedisStub();
      this.isStub = true;
      return;
    }

    const resolved = resolveRedisConnection(this.config, 'cache', {
      lazyConnect: true,
      retryStrategy: () => null,
    });
    logRedisConnectionConfig(resolved);
    this.client = new Redis(resolved.options);

    this.client.on('error', (err: Error) => {
      if (!this.errorLogged) {
        this.errorLogged = true;
        console.warn('[Redis] Connection failed:', err.message, '- Cache/Queue disabled. Start Redis or use OTP_USE_MEMORY_STORE=true for OTP.');
      }
    });
  }

  async onModuleInit() {
    if (!enableRedis || this.isStub) return;

    const redis = this.client as Redis;

    try {
      await redis.connect();
      await redis.ping();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Redis] ping failed — not connected:', msg);
      const isProd = this.config.get('NODE_ENV') === 'production';
      if (isProd && requireRedisInProduction) {
        throw new Error(
          `[Redis] Production requires Redis but connection failed: ${msg}. ` +
            'Set REQUIRE_REDIS_IN_PRODUCTION=false to allow startup without Redis (not recommended).',
        );
      }
    }
  }

  getClient(): Redis {
    return this.client as Redis;
  }

  /**
   * For ops/load-lab (e.g. k6): live ping when Redis is enabled; stub/off skip ping.
   * Does not expose URLs or passwords.
   */
  async getDiagnostics(): Promise<RedisDiagnostics> {
    if (!enableRedis) {
      return { enableRedisFlag: false, mode: 'off', ping: 'skipped' };
    }
    if (this.isStub) {
      return { enableRedisFlag: true, mode: 'stub', ping: 'skipped' };
    }
    const redis = this.client as Redis;
    const t0 = Date.now();
    try {
      const pong = await redis.ping();
      const ok = pong === 'PONG';
      return {
        enableRedisFlag: true,
        mode: 'live',
        ping: ok ? 'ok' : 'error',
        pingMs: Date.now() - t0,
        ...(ok ? {} : { error: `unexpected_ping_${String(pong)}` }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        enableRedisFlag: true,
        mode: 'live',
        ping: 'error',
        error: msg,
      };
    }
  }

  async onModuleDestroy() {
    if (this.isStub) {
      await (this.client as ReturnType<typeof createRedisStub>).quit();
      return;
    }
    const redis = this.client as Redis;
    /** Proxy / Ctrl+C often closes the TCP socket before Nest runs destroy — quit() then throws "Connection is closed". */
    if (redis.status === 'end') {
      return;
    }
    if (redis.status !== 'ready') {
      try {
        redis.disconnect();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      await redis.quit();
    } catch {
      try {
        redis.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}
