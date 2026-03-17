import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { CacheService } from './cache.service';
import { SlotLockService } from '../booking/slot-lock.service';

@Global()
@Module({
  providers: [RedisService, CacheService, SlotLockService],
  exports: [RedisService, CacheService, SlotLockService],
})
export class RedisModule {}
