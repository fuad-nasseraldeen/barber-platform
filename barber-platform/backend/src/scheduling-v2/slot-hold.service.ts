/**
 * Concurrency-safe slot holds via PostgreSQL EXCLUDE (GiST) on (staff_id, tstzrange).
 *
 * Uses `try_acquire_slot_hold` PL/pgSQL function for single-roundtrip atomic insert.
 * Expired-hold cleanup runs via @Cron in AutomationSchedulerService (not per-request).
 */

import {
  Injectable,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import {
  BOOKING_SLOT_CONFLICT_CODE,
  BOOKING_SLOT_CONFLICT_MESSAGE,
} from '../booking/booking-lock.errors';

/** @deprecated Prefer HTTP message {@link BOOKING_SLOT_CONFLICT_MESSAGE} — kept for client string checks. */
export const SLOT_ALREADY_TAKEN = 'SLOT_ALREADY_TAKEN';

const DEFAULT_HOLD_TTL_SECONDS = 300;

export type CreateSlotHoldParams = {
  staffId: string;
  startTime: Date;
  endTime: Date;
  userId: string;
  /** Required so confirmBooking(holdId) can create Appointment without extra payload */
  businessId: string;
  customerId: string;
  serviceId: string;
  holdTtlSeconds?: number;
};

type AcquireHoldRow = {
  hold_id: string | null;
  staff_id: string;
  start_time: Date;
  end_time: Date;
  expires_at: Date;
  conflict: boolean;
};

/**
 * Booking Core Stable v1
 * Frozen after correctness/performance validation.
 * Modify cautiously.
 */
@Injectable()
export class SlotHoldService {
  private readonly logger = new Logger(SlotHoldService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomic hold acquisition: single DB round-trip via `try_acquire_slot_hold`.
   * EXCLUDE constraint on unconsumed holds prevents overlapping reservations per staff.
   */
  async createSlotHold(params: CreateSlotHoldParams): Promise<{
    hold: {
      id: string;
      staffId: string;
      startTime: Date;
      endTime: Date;
      userId: string;
      expiresAt: Date;
    };
    expiresAt: Date;
  }> {
    if (params.startTime >= params.endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }

    const ttl = params.holdTtlSeconds ?? DEFAULT_HOLD_TTL_SECONDS;
    const expiresAt = DateTime.utc().plus({ seconds: ttl }).toJSDate();

    if (process.env.SLOT_HOLD_CONFLICT_DEBUG === '1') {
      const conflictingRowsFromDB = await this.prisma.$queryRaw<
        Array<{
          id: string;
          start_time: Date;
          end_time: Date;
          expires_at: Date;
          consumed_at: Date | null;
        }>
      >`
        SELECT id, start_time, end_time, expires_at, consumed_at
        FROM slot_holds
        WHERE staff_id = ${params.staffId}
          AND business_id = ${params.businessId}
          AND start_time < ${params.endTime}
          AND end_time > ${params.startTime}
      `;
      console.log(
        JSON.stringify({
          type: 'slot_hold_before_insert_overlap_query',
          conflictingRowsFromDB,
          nowIso: DateTime.utc().toISO(),
          attemptedRange: {
            startIso: params.startTime.toISOString(),
            endIso: params.endTime.toISOString(),
          },
        }),
      );
    }

    const rows = await this.prisma.$queryRaw<AcquireHoldRow[]>`
      SELECT * FROM try_acquire_slot_hold(
        ${params.businessId},
        ${params.staffId},
        ${params.customerId},
        ${params.serviceId},
        ${params.userId},
        ${params.startTime},
        ${params.endTime},
        ${expiresAt}
      )
    `;

    const result = rows[0];
    if (!result || result.conflict || !result.hold_id) {
      this.logger.warn('[SlotHold] createSlotHold → CONFLICT (EXCLUDE)', {
        staffId: params.staffId,
        businessId: params.businessId,
      });
      throw new ConflictException({
        code: BOOKING_SLOT_CONFLICT_CODE,
        message: BOOKING_SLOT_CONFLICT_MESSAGE,
      });
    }

    return {
      hold: {
        id: result.hold_id,
        staffId: params.staffId,
        startTime: result.start_time,
        endTime: result.end_time,
        userId: params.userId,
        expiresAt: result.expires_at,
      },
      expiresAt: result.expires_at,
    };
  }
}
