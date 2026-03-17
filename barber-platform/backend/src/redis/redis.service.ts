import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { enableRedis } from '../common/redis-config';
import { createRedisStub } from './redis-stub';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: Redis | ReturnType<typeof createRedisStub>;
  private errorLogged = false;
  private isStub = false;

  constructor(private config: ConfigService) {
    if (!enableRedis) {
      this.client = createRedisStub();
      this.isStub = true;
      return;
    }

    const url = this.config.get<string>('REDIS_URL');
    const tls = this.config.get<string>('REDIS_TLS') === 'true';

    const baseOpts = {
      lazyConnect: true,
      retryStrategy: () => null,
      ...(tls && { tls: {} }),
    };

    if (url) {
      this.client = new Redis(url, baseOpts);
    } else {
      this.client = new Redis({
        host: this.config.get('REDIS_HOST', 'localhost'),
        port: this.config.get('REDIS_PORT', 6379),
        password: this.config.get('REDIS_PASSWORD') || undefined,
        ...baseOpts,
      });
    }

    this.client.on('error', (err: Error) => {
      if (!this.errorLogged) {
        this.errorLogged = true;
        console.warn('[Redis] Connection failed:', err.message, '- Cache/Queue disabled. Start Redis or use OTP_USE_MEMORY_STORE=true for OTP.');
      }
    });
  }

  getClient(): Redis {
    return this.client as Redis;
  }

  async onModuleDestroy() {
    if (this.isStub) {
      await (this.client as ReturnType<typeof createRedisStub>).quit();
    } else {
      await (this.client as Redis).quit();
    }
  }
}
