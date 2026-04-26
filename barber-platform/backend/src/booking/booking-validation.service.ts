import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import {
  businessLocalDayBounds,
  businessLocalDayOfWeek,
  isBookableBlockWithinWorkingWindow,
  resolveScheduleWallClockZone,
  resolveStaffWorkingHoursForBusinessLocalDay,
  utcToBusinessLocalMinutesSinceDayStart,
  utcToBusinessLocalYmd,
  wallHhmmStringToMinuteOfDay,
} from '../common/business-local-time';
import { isWithinBusinessBookingWindow } from '../common/time-engine';

type PrismaClientLike = Pick<
  PrismaClient,
  | 'business'
  | 'staff'
  | 'businessHoliday'
  | '$queryRaw'
>;

export type ValidateBookingSlotInput = {
  businessId: string;
  staffId: string;
  startTime: Date;
  endTime: Date;
  serviceId?: string;
  /** @deprecated Overlap is enforced by PostgreSQL EXCLUDE; kept for API compat */
  excludeAppointmentId?: string;
  calendarDate?: string;
  startTimeHHmm?: string;
  /** Pre-resolved IANA zone — skips the business.findUnique round-trip. */
  resolvedTimeZone?: string;
  instrumentation?: ValidateBookingSlotInstrumentation;
};

export type ValidateBookingSlotInstrumentation = {
  staffValidationMs?: number;
  availabilityValidationMs?: number;
  loadStaffBundleMs?: number;
  staffConstraintValidationMs?: number;
  workingHoursValidationMs?: number;
  breaksValidationMs?: number;
  timeOffValidationMs?: number;
  holidayValidationMs?: number;
};

export type ValidateBookingSlotResult =
  | { valid: true }
  | {
      valid: false;
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    };

@Injectable()
export class BookingValidationService {
  private readonly logger = new Logger(BookingValidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Working hours, breaks, time off, holiday. Overlap is DB EXCLUDE only.
   *
   * Uses a single staff.findFirst with all includes (2 PG ops: staff bundle + holidays in parallel)
   * instead of 8 separate queries.
   */
  async validateBookingSlot(
    input: ValidateBookingSlotInput,
    tx?: PrismaClientLike,
  ): Promise<ValidateBookingSlotResult> {
    const { businessId, staffId, startTime, endTime } = input;
    const db = tx ?? this.prisma;

    let tz: string;
    if (input.resolvedTimeZone) {
      tz = resolveScheduleWallClockZone(input.resolvedTimeZone);
    } else {
      const bizRow = await db.business.findUnique({
        where: { id: businessId },
        select: { timezone: true },
      });
      tz = resolveScheduleWallClockZone(bizRow?.timezone);
    }

    const dateStr = (
      input.calendarDate ??
      DateTime.fromJSDate(startTime, { zone: 'utc' }).setZone(tz).toISODate()!
    ).slice(0, 10);
    const startTimeStr =
      input.startTimeHHmm ??
      DateTime.fromJSDate(startTime, { zone: 'utc' }).setZone(tz).toFormat('HH:mm');

    const dayOfWeek = businessLocalDayOfWeek(tz, dateStr);

    const localYmdStart = utcToBusinessLocalYmd(startTime, tz);
    const localYmdEnd = utcToBusinessLocalYmd(endTime, tz);
    if (localYmdStart !== dateStr || localYmdEnd !== dateStr) {
      return {
        valid: false,
        error: {
          code: 'SLOT_DATE_MISMATCH',
          message:
            'Appointment must start and end on the requested calendar date in the business timezone',
          details: { dateStr, localYmdStart, localYmdEnd },
        },
      };
    }

    const rawWin = this.config.get('BOOKING_WINDOW_DAYS', '90');
    const windowDays = parseInt(rawWin, 10) || 90;
    console.log({
      now: new Date(),
      bookingWindowDays: process.env.BOOKING_WINDOW_DAYS,
      requestedDate: input.startTime,
    });
    if (!isWithinBusinessBookingWindow(dateStr, tz, windowDays)) {
      return {
        valid: false,
        error: {
          code: 'OUTSIDE_BOOKING_WINDOW',
          message: 'Date is outside the booking window',
          details: { date: dateStr },
        },
      };
    }

    const { startMs: whDayStartMs, endMs: whDayEndExMs } = businessLocalDayBounds(tz, dateStr);
    const whRangeStart = new Date(whDayStartMs);
    const whRangeEndExclusive = new Date(whDayEndExMs);
    const dateOnly = new Date(dateStr);

    // Single batched load: staff bundle (all includes) + holidays in parallel (2 PG ops)
    const tStaffValidation0 = Date.now();
    const tLoadStaffBundle0 = Date.now();
    const [staffBundle, holidayRows] = await Promise.all([
      db.staff.findFirst({
        where: { id: staffId, businessId, isActive: true, deletedAt: null },
        include: {
          staffWorkingHours: true,
          staffWorkingHoursDateOverrides: {
            where: {
              date: { gte: whRangeStart, lt: whRangeEndExclusive },
            },
          },
          staffBreaks: {
            where: { staffId },
          },
          staffBreakExceptions: {
            where: { staffId, date: dateOnly },
          },
          staffTimeOff: {
            where: {
              staffId,
              status: 'APPROVED',
              startDate: { lte: dateOnly },
              endDate: { gte: dateOnly },
            },
          },
        },
      }),
      db.businessHoliday.findMany({
        where: {
          businessId,
          OR: [
            {
              isRecurring: false,
              date: { gte: whRangeStart, lt: whRangeEndExclusive },
            },
            { isRecurring: true },
          ],
        },
        select: { date: true, isRecurring: true },
      }),
    ]);
    if (input.instrumentation) {
      input.instrumentation.loadStaffBundleMs = Date.now() - tLoadStaffBundle0;
    }

    const tStaffConstraintValidation0 = Date.now();
    if (!staffBundle) {
      if (input.instrumentation) {
        input.instrumentation.staffConstraintValidationMs =
          Date.now() - tStaffConstraintValidation0;
        input.instrumentation.staffValidationMs = Date.now() - tStaffValidation0;
      }
      return {
        valid: false,
        error: {
          code: 'STAFF_NOT_FOUND',
          message: 'Staff member not found or inactive',
          details: { staffId },
        },
      };
    }
    if (input.instrumentation) {
      input.instrumentation.staffConstraintValidationMs =
        Date.now() - tStaffConstraintValidation0;
      input.instrumentation.staffValidationMs = Date.now() - tStaffValidation0;
    }

    const tAvailabilityValidation0 = Date.now();
    const finalizeAvailabilityValidation = () => {
      if (input.instrumentation) {
        input.instrumentation.availabilityValidationMs =
          Date.now() - tAvailabilityValidation0;
      }
    };
    const tWorkingHoursValidation0 = Date.now();
    const workingHours = resolveStaffWorkingHoursForBusinessLocalDay({
      ymd: dateStr,
      timeZone: tz,
      weeklyRows: staffBundle.staffWorkingHours,
      dateOverrides: staffBundle.staffWorkingHoursDateOverrides,
    });

    if (!workingHours) {
      if (input.instrumentation) {
        input.instrumentation.workingHoursValidationMs =
          Date.now() - tWorkingHoursValidation0;
      }
      finalizeAvailabilityValidation();
      return {
        valid: false,
        error: {
          code: 'NO_WORKING_HOURS',
          message: 'Staff has no working hours on this day',
          details: { dayOfWeek, date: dateStr },
        },
      };
    }

    const whStartMin = wallHhmmStringToMinuteOfDay(workingHours.startTime);
    const whEndMin = wallHhmmStringToMinuteOfDay(workingHours.endTime);
    const reqStartMin = utcToBusinessLocalMinutesSinceDayStart(startTime, tz, dateStr);
    const reqEndMin = utcToBusinessLocalMinutesSinceDayStart(endTime, tz, dateStr);

    if (this.config.get<string>('LOG_BOOKING_WORKING_MINUTES_DEBUG') === '1') {
      this.logger.log(
        JSON.stringify({
          type: 'BOOKING_WORKING_MINUTES_DEBUG',
          dateStr,
          workingStart: whStartMin,
          workingEnd: whEndMin,
          slotStart: reqStartMin,
          slotEnd: reqEndMin,
          workingStartMin: whStartMin,
          workingEndMin: whEndMin,
          slotStartMin: reqStartMin,
          slotEndMin: reqEndMin,
        }),
      );
    }

    if (!isBookableBlockWithinWorkingWindow(reqStartMin, reqEndMin, whStartMin, whEndMin)) {
      if (input.instrumentation) {
        input.instrumentation.workingHoursValidationMs =
          Date.now() - tWorkingHoursValidation0;
      }
      finalizeAvailabilityValidation();
      return {
        valid: false,
        error: {
          code: 'OUTSIDE_WORKING_HOURS',
          message: `Slot is outside working hours (${workingHours.startTime}-${workingHours.endTime})`,
          details: {
            startTime: startTimeStr,
            workingStartMin: whStartMin,
            workingEndMin: whEndMin,
            slotStartMin: reqStartMin,
            slotEndMin: reqEndMin,
          },
        },
      };
    }
    if (input.instrumentation) {
      input.instrumentation.workingHoursValidationMs =
        Date.now() - tWorkingHoursValidation0;
    }

    // Breaks: weekly + date-specific exceptions (already loaded in staff bundle)
    const tBreaksValidation0 = Date.now();
    const breaks = [
      ...staffBundle.staffBreaks
        .filter((b) => b.dayOfWeek === dayOfWeek)
        .map((b) => ({ startTime: b.startTime, endTime: b.endTime })),
      ...staffBundle.staffBreakExceptions.map((b) => ({
        startTime: b.startTime,
        endTime: b.endTime,
      })),
    ];

    for (const b of breaks) {
      const bStartMin = wallHhmmStringToMinuteOfDay(b.startTime);
      const bEndMin = wallHhmmStringToMinuteOfDay(b.endTime);
      if (reqStartMin < bEndMin && reqEndMin > bStartMin) {
        if (input.instrumentation) {
          input.instrumentation.breaksValidationMs =
            Date.now() - tBreaksValidation0;
        }
        finalizeAvailabilityValidation();
        return {
          valid: false,
          error: {
            code: 'OVERLAPS_BREAK',
            message: 'Slot overlaps with a break',
            details: { breakTime: `${b.startTime}-${b.endTime}` },
          },
        };
      }
    }
    if (input.instrumentation) {
      input.instrumentation.breaksValidationMs = Date.now() - tBreaksValidation0;
    }

    const tTimeOffValidation0 = Date.now();
    if (staffBundle.staffTimeOff.length > 0) {
      if (input.instrumentation) {
        input.instrumentation.timeOffValidationMs =
          Date.now() - tTimeOffValidation0;
      }
      finalizeAvailabilityValidation();
      return {
        valid: false,
        error: {
          code: 'STAFF_TIME_OFF',
          message: 'Staff is on time off on this date',
          details: { date: dateStr },
        },
      };
    }
    if (input.instrumentation) {
      input.instrumentation.timeOffValidationMs =
        Date.now() - tTimeOffValidation0;
    }

    // Holiday check: match recurring by month+day, non-recurring by date range
    const tHolidayValidation0 = Date.now();
    const [, mo, da] = dateStr.split('-').map(Number);
    const isHoliday = holidayRows.some((h) => {
      if (!h.isRecurring) return true;
      const hDate = h.date instanceof Date ? h.date : new Date(h.date as string);
      return hDate.getUTCMonth() + 1 === mo && hDate.getUTCDate() === da;
    });

    if (isHoliday) {
      if (input.instrumentation) {
        input.instrumentation.holidayValidationMs =
          Date.now() - tHolidayValidation0;
      }
      finalizeAvailabilityValidation();
      return {
        valid: false,
        error: {
          code: 'BUSINESS_HOLIDAY',
          message: 'Business is closed on this date (holiday)',
          details: { date: dateStr },
        },
      };
    }
    if (input.instrumentation) {
      input.instrumentation.holidayValidationMs =
        Date.now() - tHolidayValidation0;
    }

    finalizeAvailabilityValidation();

    return { valid: true };
  }
}
