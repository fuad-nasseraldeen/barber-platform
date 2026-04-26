import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { CacheService } from './cache.service';
import { CacheBustMetricsService } from './cache-bust-metrics.service';

@Global()
@Module({
  providers: [RedisService, CacheBustMetricsService, CacheService],
  exports: [RedisService, CacheService, CacheBustMetricsService],
})
export class RedisModule {}
