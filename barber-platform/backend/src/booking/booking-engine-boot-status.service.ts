import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { resolveScheduleWallClockZone } from '../common/business-local-time';
import { ensureValidBusinessZone } from '../common/time-engine';

@Injectable()
export class BookingEngineBootStatusService implements OnModuleInit {
  private readonly logger = new Logger(BookingEngineBootStatusService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    const useTimeSlots = this.config.get<string>('USE_TIME_SLOTS') === '1';
    const projectionModeActive = useTimeSlots;
    const bookingWindowDaysRaw = this.config.get<string>('BOOKING_WINDOW_DAYS', '14');
    const bookingWindowDaysParsed = parseInt(bookingWindowDaysRaw, 10);
    const bookingWindowDays =
      Number.isFinite(bookingWindowDaysParsed) && bookingWindowDaysParsed > 0
        ? bookingWindowDaysParsed
        : 14;

    let redisDiag: {
      enableRedisFlag: boolean;
      mode: 'off' | 'stub' | 'live';
      ping: 'ok' | 'error' | 'skipped';
      pingMs?: number;
      error?: string;
    };
    try {
      redisDiag = await this.redis.getDiagnostics();
    } catch (error) {
      redisDiag = {
        enableRedisFlag: this.config.get<string>('ENABLE_REDIS') === 'true',
        mode: 'live',
        ping: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const redisConnected = redisDiag.mode === 'live' && redisDiag.ping === 'ok';

    const configuredBusinessId = this.config.get<string>('BUSINESS_ID') ?? null;
    let businessId: string | null = configuredBusinessId;
    let businessTimezone: string | null = null;
    try {
      const business =
        configuredBusinessId != null
          ? await this.prisma.business.findUnique({
              where: { id: configuredBusinessId },
              select: { id: true, timezone: true },
            })
          : await this.prisma.business.findFirst({
              where: { deletedAt: null, isActive: true },
              select: { id: true, timezone: true },
              orderBy: { createdAt: 'asc' },
            });
      if (business) {
        businessId = business.id;
        businessTimezone = ensureValidBusinessZone(
          resolveScheduleWallClockZone(business.timezone),
        );
      }
    } catch {
      businessTimezone = null;
    }

    const businessNow =
      businessTimezone != null
        ? DateTime.now().setZone(businessTimezone).toISO({ includeOffset: true })
        : null;

    this.logger.log(
      JSON.stringify({
        type: 'BOOKING_ENGINE_BOOT_STATUS',
        timeSlotsEnabled: useTimeSlots,
        redisConnected,
        projectionModeActive,
        bookingWindowDays,
        businessId,
        businessTimezone,
        businessNow,
        redis: {
          mode: redisDiag.mode,
          ping: redisDiag.ping,
          pingMs: redisDiag.pingMs ?? null,
          error: redisDiag.error ?? null,
        },
      }),
    );
  }
}
