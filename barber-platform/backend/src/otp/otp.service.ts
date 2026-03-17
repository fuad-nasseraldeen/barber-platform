import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { OtpMemoryStore } from './otp-memory-store';
import { enableRedis } from '../common/redis-config';
import * as crypto from 'crypto';

const OTP_LENGTH = 6;
const OTP_TTL_SECONDS = 300; // 5 minutes
const RATE_LIMIT_TTL = 900; // 15 min window
const MAX_OTP_REQUESTS_PER_WINDOW = 3;
const MAX_VERIFY_ATTEMPTS = 5;
const VERIFY_ATTEMPT_TTL = 300;

type StoreLike = {
  get(key: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
};

@Injectable()
export class OtpService {
  private store: StoreLike;
  private useMemory: boolean;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.useMemory =
      !enableRedis || this.config.get('OTP_USE_MEMORY_STORE') === 'true';
    this.store = this.useMemory ? new OtpMemoryStore() : this.createRedisStore();
    if (this.useMemory && !enableRedis) {
      // Silent when Redis disabled - main startup log covers it
    } else if (this.useMemory) {
      console.warn('[OTP] Using in-memory store (OTP_USE_MEMORY_STORE=true). Redis not required.');
    }
  }

  private createRedisStore(): StoreLike {
    const client = this.redis.getClient();
    return {
      get: (k) => client.get(k),
      setex: async (k, ttl, v) => {
        await client.setex(k, ttl, v);
      },
      del: async (k) => {
        await client.del(k);
      },
      incr: (k) => client.incr(k),
      expire: async (k, s) => {
        await client.expire(k, s);
      },
      ttl: (k) => client.ttl(k),
    };
  }

  private hashCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  private otpKey(phone: string): string {
    return `otp:${phone}`;
  }

  private rateLimitKey(phone: string): string {
    return `otp:ratelimit:${phone}`;
  }

  private verifyAttemptsKey(phone: string): string {
    return `otp:verify:${phone}`;
  }

  async createAndStoreOtp(phone: string): Promise<string> {
    await this.checkRateLimit(phone);

    const code = this.generateCode();
    const hash = this.hashCode(code);

    const key = this.otpKey(phone);
    await this.store.setex(key, OTP_TTL_SECONDS, hash);

    await this.incrementRateLimit(phone);

    return code;
  }

  async verifyOtp(phone: string, code: string): Promise<boolean> {
    const attemptsKey = this.verifyAttemptsKey(phone);
    const attempts = await this.store.incr(attemptsKey);
    if (attempts === 1) {
      await this.store.expire(attemptsKey, VERIFY_ATTEMPT_TTL);
    }
    if (attempts > MAX_VERIFY_ATTEMPTS) {
      throw new HttpException(
        'Too many verification attempts. Please request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const key = this.otpKey(phone);
    const storedHash = await this.store.get(key);
    if (!storedHash) {
      throw new HttpException('OTP expired or invalid', HttpStatus.BAD_REQUEST);
    }

    const hash = this.hashCode(code);
    if (hash !== storedHash) {
      return false;
    }

    await this.store.del(key);
    await this.store.del(attemptsKey);
    await this.resetRateLimit(phone);
    return true;
  }

  private async checkRateLimit(phone: string): Promise<void> {
    const key = this.rateLimitKey(phone);
    const count = await this.store.get(key);
    const countNum = count ? parseInt(count, 10) : 0;
    if (countNum >= MAX_OTP_REQUESTS_PER_WINDOW) {
      const ttl = await this.store.ttl(key);
      throw new HttpException(
        `Too many OTP requests. Try again in ${Math.ceil(ttl / 60)} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async incrementRateLimit(phone: string): Promise<void> {
    const key = this.rateLimitKey(phone);
    const count = await this.store.incr(key);
    if (count === 1) {
      await this.store.expire(key, RATE_LIMIT_TTL);
    }
  }

  private async resetRateLimit(phone: string): Promise<void> {
    await this.store.del(this.rateLimitKey(phone));
  }

  private generateCode(): string {
    const digits = '0123456789';
    let code = '';
    const randomBytes = crypto.randomBytes(OTP_LENGTH);
    for (let i = 0; i < OTP_LENGTH; i++) {
      code += digits[randomBytes[i] % 10];
    }
    return code;
  }
}
