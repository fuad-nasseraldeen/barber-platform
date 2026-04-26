import {
  Controller,
  Get,
  Logger,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  ForbiddenException,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ACCEPTABLE_MONITORING_RATES } from './metrics.service';
import { BookingService } from './booking.service';
import { AvailabilityMetricsService } from '../availability/availability-metrics.service';
import { StaffReadinessValidatorService } from '../availability/staff-readiness-validator.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { BookAppointmentDto } from './dto/book-appointment.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { ConvertWaitlistDto } from '../waitlist/dto/convert-waitlist.dto';
import { ListAppointmentsQueryDto } from './dto/list-appointments.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { CreateSlotHoldRequestDto } from './dto/create-slot-hold-request.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { BookingPerfEndpoint } from '../common/decorators/booking-perf.decorator';
import { BookingPerfInterceptor } from '../common/interceptors/booking-perf.interceptor';
import { JsonSerializeTimingInterceptor } from '../common/interceptors/json-serialize-timing.interceptor';
import { AvailabilityTimingInterceptor } from '../common/interceptors/availability-timing.interceptor';
import { AvailabilityDebugService } from '../availability/availability-debug.service';
import { AvailabilitySlotDebugService } from '../availability/availability-slot-debug.service';
import { TimeSlotService } from '../availability/time-slot.service';
import type { GetAvailabilityHttpTiming } from '../availability/availability-http-timing.types';
import { CacheBustMetricsService } from '../redis/cache-bust-metrics.service';

/**
 * POST /book: default 10/min was too low for k6 (single JWT). Tune with BOOK_THROTTLE_PER_MIN or
 * DISABLE_BOOKING_THROTTLE=1. Pool JWTs via K6_AUTH_TOKENS for fairer per-user limits.
 */
const BOOK_THROTTLE_LIMIT =
  process.env.DISABLE_BOOKING_THROTTLE === '1'
    ? 1_000_000
    : Math.max(
        10,
        parseInt(process.env.BOOK_THROTTLE_PER_MIN || '240', 10) || 240,
      );

const BOOK_THROTTLE = {
  default: { limit: BOOK_THROTTLE_LIMIT, ttl: 60_000 },
} as const;

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(BookingPerfInterceptor, JsonSerializeTimingInterceptor)
export class BookingController {
  private readonly logger = new Logger(BookingController.name);

  constructor(
    private readonly booking: BookingService,
    private readonly waitlist: WaitlistService,
    private readonly availabilityMetrics: AvailabilityMetricsService,
    private readonly staffReadiness: StaffReadinessValidatorService,
    private readonly availabilityDebug: AvailabilityDebugService,
    private readonly availabilitySlotDebug: AvailabilitySlotDebugService,
    private readonly timeSlots: TimeSlotService,
    private readonly cacheBustMetrics: CacheBustMetricsService,
  ) {}

  @Get('appointments')
  @Roles('owner', 'manager', 'staff')
  @Permissions('appointment:read')
  async listAppointments(@Query() query: ListAppointmentsQueryDto) {
    return this.booking.findAll(query.businessId, {
      branchId: query.branchId,
      startDate: query.startDate,
      endDate: query.endDate,
      status: query.status,
      staffId: query.staffId,
      customerId: query.customerId,
      limit: query.limit,
      page: query.page,
    });
  }

  @Post('appointments/slot-holds')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @BookingPerfEndpoint('hold')
  @Roles('owner', 'manager', 'staff', 'customer')
  @Permissions('appointment:create')
  async createSlotHold(
    @Body() dto: CreateSlotHoldRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.booking.createSlotHoldForSlotSelection(dto, userId);
  }

  @Post('appointments/create')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('owner', 'manager', 'staff')
  @Permissions('appointment:create')
  async createAppointment(@Body() dto: CreateAppointmentDto) {
    return this.booking.createAppointment(dto);
  }

  @Get('appointments/metrics')
  @Roles('owner', 'manager')
  @Permissions('appointment:read')
  async getBookingMetrics(@Query('businessId') businessId?: string) {
    return {
      ...this.booking.getMetrics(businessId || undefined),
      availability: this.availabilityMetrics.getSnapshot(),
      cacheBustDelPattern: this.cacheBustMetrics.getSnapshot(),
      acceptableRates: ACCEPTABLE_MONITORING_RATES,
    };
  }

  @SkipThrottle({ short: true, medium: true, long: true })
  @Get('availability')
  @BookingPerfEndpoint('availability')
  @UseInterceptors(AvailabilityTimingInterceptor)
  @Roles('owner', 'manager', 'staff', 'customer')
  @Permissions('appointment:read')
  async getAvailability(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @Query() query: AvailabilityQueryDto,
    @CurrentUser('id') viewerUserId: string,
  ) {
    if (process.env.LOG_AVAILABILITY_QUERY_DEBUG === '1') {
      console.log('RAW QUERY:', req.query);
      console.log('COMPACT AFTER TRANSFORM:', query.compact);
    }
    if (process.env.LOG_AVAILABILITY_COMPACT_DEBUG === '1') {
      console.log('COMPACT VALUE:', query.compact);
    }
    const timingForHeader: GetAvailabilityHttpTiming | undefined =
      process.env.AVAILABILITY_TIMING_RESPONSE_HEADER === '1' ||
      process.env.LOG_AVAILABILITY_TIMING === '1'
        ? {
            populated: false,
            dayMap: {
              path: '',
              totalMs: 0,
              redisMs: 0,
              redisCallCount: 0,
              payloadSizeBytes: 0,
              keysPerRequest: 0,
              dbMs: 0,
              busyPrepMs: 0,
              computeMs: 0,
            },
            envelope: {
              totalMs: 0,
              bookingBusinessTzMs: 0,
              dayMapCallMs: 0,
              bookingAfterDayMapMs: 0,
            },
          }
        : undefined;
    const results = await this.booking.getAvailability(
      query,
      viewerUserId,
      timingForHeader,
    );
    if (timingForHeader) {
      res.setHeader(
        'X-Availability-Timing',
        JSON.stringify(timingForHeader),
      );
    }
    if (process.env.LOG_AVAILABILITY_RESPONSE_JSON === '1') {
      this.logger.log(`GET /availability response JSON: ${JSON.stringify(results)}`);
    }
    return results;
  }

  /**
   * Structured slot-by-slot reasons (internal). Requires AVAILABILITY_SLOT_DEBUG=1 on the API.
   */
  @SkipThrottle({ short: true, medium: true, long: true })
  @Get('availability/debug')
  @Roles('owner', 'manager')
  @Permissions('appointment:read')
  async getAvailabilityDebug(
    @Query() query: AvailabilityQueryDto,
    @CurrentUser('businessId') userBusinessId: string | undefined,
  ) {
    if (process.env.AVAILABILITY_SLOT_DEBUG !== '1') {
      throw new ForbiddenException(
        'Enable AVAILABILITY_SLOT_DEBUG=1 on the server to use GET /availability/debug.',
      );
    }
    if (!userBusinessId || userBusinessId !== query.businessId) {
      throw new ForbiddenException('Business context required; businessId must match authenticated tenant.');
    }
    return this.availabilitySlotDebug.build(query);
  }

  @SkipThrottle({ short: true, medium: true, long: true })
  @Get('availability/debug-day')
  @Roles('owner', 'manager')
  @Permissions('appointment:read')
  async debugDayAvailability(
    @Query('staffId') staffId: string,
    @Query('date') date: string,
    @Query('probeMinutes') probeMinutes: string | undefined,
    @Query('bufferBefore') bufferBefore: string | undefined,
    @Query('bufferAfter') bufferAfter: string | undefined,
    @CurrentUser('businessId') userBusinessId: string | undefined,
  ) {
    if (process.env.AVAILABILITY_DEBUG_DAY !== '1') {
      throw new ForbiddenException('Enable AVAILABILITY_DEBUG_DAY=1 on the server to use this endpoint.');
    }
    if (!userBusinessId) {
      throw new ForbiddenException('Business context required');
    }
    if (!staffId || !date) {
      throw new BadRequestException('staffId and date (YYYY-MM-DD) are required');
    }
    const pm = probeMinutes != null ? parseInt(probeMinutes, 10) : 100;
    const bb = bufferBefore != null ? parseInt(bufferBefore, 10) : 0;
    const ba = bufferAfter != null ? parseInt(bufferAfter, 10) : 0;
    await this.availabilityDebug.debugDayAvailability(staffId, date.slice(0, 10), {
      expectedBusinessId: userBusinessId,
      probeServiceDurationMinutes: Number.isFinite(pm) ? pm : 100,
      bufferBefore: Number.isFinite(bb) ? bb : 0,
      bufferAfter: Number.isFinite(ba) ? ba : 0,
    });
    return { ok: true, message: 'See server logs for [debugDayAvailability] lines' };
  }

  @SkipThrottle({ short: true, medium: true, long: true })
  @Get('availability/debug-availability-day')
  @Roles('owner', 'manager')
  @Permissions('appointment:read')
  async debugAvailabilityDayJson(
    @Query('staffId') staffId: string,
    @Query('date') date: string,
    @Query('serviceDurationMinutes') serviceDurationMinutes: string | undefined,
    @Query('serviceDuration') serviceDuration: string | undefined,
    @Query('bufferBefore') bufferBefore: string | undefined,
    @Query('bufferAfter') bufferAfter: string | undefined,
    @CurrentUser('businessId') userBusinessId: string | undefined,
  ) {
    if (process.env.AVAILABILITY_DEBUG_DAY !== '1') {
      throw new ForbiddenException('Enable AVAILABILITY_DEBUG_DAY=1 on the server to use this endpoint.');
    }
    if (!userBusinessId) {
      throw new ForbiddenException('Business context required');
    }
    if (!staffId || !date) {
      throw new BadRequestException('staffId and date (YYYY-MM-DD) are required');
    }
    const durRaw = serviceDurationMinutes ?? serviceDuration;
    const sd = durRaw != null ? parseInt(durRaw, 10) : 30;
    const bb = bufferBefore != null ? parseInt(bufferBefore, 10) : 0;
    const ba = bufferAfter != null ? parseInt(bufferAfter, 10) : 0;
    return this.availabilityDebug.debugAvailabilityDayStructured(
      staffId,
      date.slice(0, 10),
      Number.isFinite(sd) ? sd : 30,
      {
        expectedBusinessId: userBusinessId,
        bufferBefore: Number.isFinite(bb) ? bb : 0,
        bufferAfter: Number.isFinite(ba) ? ba : 0,
      },
    );
  }

  @SkipThrottle({ short: true, medium: true, long: true })
  @Get('availability/health')
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async availabilityHealth(@CurrentUser('businessId') userBusinessId: string | undefined) {
    if (!userBusinessId) {
      throw new ForbiddenException('Business context required');
    }
    return this.staffReadiness.getBusinessHealth(userBusinessId);
  }

  @Post(['appointments/book', 'book'])
  @HttpCode(HttpStatus.CREATED)
  @Throttle(BOOK_THROTTLE)
  @BookingPerfEndpoint('booking')
  @Roles('owner', 'manager', 'staff', 'customer')
  @Permissions('appointment:create')
  async bookAppointment(
    @Body() dto: BookAppointmentDto,
    @CurrentUser() user: { id: string; role?: string },
  ) {
    const requireHoldOwnerUserId = user.role === 'customer' ? user.id : undefined;
    return this.booking.bookAppointment(dto, requireHoldOwnerUserId);
  }

  @Post('appointments/cancel')
  @Roles('owner', 'manager', 'staff')
  @Permissions('appointment:update', 'appointment:delete')
  async cancelAppointment(@Body() dto: CancelAppointmentDto) {
    const cancelled = await this.booking.cancelAppointment(
      dto.appointmentId,
      dto.businessId,
      dto.reason,
    );

    const dateStr = (cancelled as { startTime: Date }).startTime.toISOString().slice(0, 10);
    const startTime = (cancelled as { startTime: Date }).startTime.toISOString().slice(11, 16);
    const apt = cancelled as { businessId: string; staffId: string; serviceId: string };
    this.waitlist
      .processSlotAvailable({
        businessId: apt.businessId,
        staffId: apt.staffId,
        serviceId: apt.serviceId,
        date: dateStr,
        startTime,
      })
      .catch((e) => console.error('[Waitlist] processSlotAvailable failed:', e));

    return cancelled;
  }

  @Post('appointments/:id/status')
  @Roles('owner', 'manager', 'staff')
  @Permissions('appointment:update')
  async updateAppointmentStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentStatusDto,
  ) {
    return this.booking.updateAppointmentStatus(id, dto.businessId, dto.status);
  }

  @Patch('appointments/:id')
  @BookingPerfEndpoint('reschedule')
  @Roles('owner', 'manager', 'staff')
  @Permissions('appointment:update')
  async updateAppointment(
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.booking.updateAppointment(id, {
      businessId: dto.businessId,
      staffId: dto.staffId,
      startTime: dto.startTime,
      endTime: dto.endTime,
    });
  }

  @Post('appointments/confirm-from-waitlist')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Roles('owner', 'manager', 'staff', 'customer')
  @Permissions('appointment:create')
  async confirmFromWaitlist(
    @Body() dto: ConvertWaitlistDto,
    @CurrentUser('id') userId: string,
  ) {
    const ok = await this.waitlist.validateNotifiedSlotMatches(dto);
    if (!ok) {
      throw new BadRequestException('Waitlist reservation expired or does not match this slot');
    }

    const appointment = await this.booking.confirmFromWaitlistConversion(dto, userId);

    await this.waitlist.markConverted(dto.waitlistId, appointment.id);
    return appointment;
  }

  @Post('availability/seed-time-slots')
  @HttpCode(HttpStatus.OK)
  @Roles('owner', 'manager')
  @Permissions('business:manage')
  async seedTimeSlots(
    @Body() body: { businessId: string; daysAhead?: number },
  ) {
    if (process.env.USE_TIME_SLOTS !== '1') {
      throw new BadRequestException('USE_TIME_SLOTS is not enabled');
    }
    const biz = await this.booking.getBusinessTimezone(body.businessId);
    return this.timeSlots.seedBusinessDays(
      body.businessId,
      biz.timezone,
      body.daysAhead ?? 14,
    );
  }
}
