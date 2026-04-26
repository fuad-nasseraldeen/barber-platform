import { Controller, Get, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RuntimeDiagnosticsService } from '../common/runtime/runtime-diagnostics.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeDiagnosticsService,
    private readonly redis: RedisService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Lightweight process metrics (no DB). Enable with ENABLE_HEALTH_DIAGNOSTICS=1 — localhost/load lab only.
   */
  @Get('diagnostics')
  async diagnostics() {
    if (process.env.ENABLE_HEALTH_DIAGNOSTICS !== '1') {
      throw new NotFoundException();
    }
    const [redis, cache] = await Promise.all([
      this.redis.getDiagnostics(),
      this.cacheWriteReadProbe(),
    ]);
    return {
      ...this.runtime.getSnapshot(),
      redis,
      cache,
    };
  }

  /** Proves CacheService → Redis/stub round-trip (SET + GET + DEL). */
  private async cacheWriteReadProbe(): Promise<{
    ok: boolean;
    roundTripMs: number;
    detail: string;
  }> {
    const key = `health:k6_cache_probe:${process.pid}:${Date.now()}`;
    const t0 = Date.now();
    await this.cache.set(key, { probe: true }, 15);
    const v = await this.cache.get<{ probe?: boolean }>(key);
    await this.cache.del(key);
    const roundTripMs = Date.now() - t0;
    if (v && v.probe === true) {
      return { ok: true, roundTripMs, detail: 'set_get_del_ok' };
    }
    return {
      ok: false,
      roundTripMs,
      detail: v == null ? 'get_miss_after_set' : 'value_mismatch',
    };
  }

  @Get()
  async check() {
    let dbStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }
    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: { database: dbStatus },
    };
  }
}
