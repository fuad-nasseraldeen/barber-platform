import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { AvailabilityService } from '../availability/availability.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { LockSlotDto } from './dto/lock-slot.dto';
import { ConfirmBookingDto } from './dto/confirm-booking.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { ConvertWaitlistDto } from '../waitlist/dto/convert-waitlist.dto';
import { ListAppointmentsQueryDto } from './dto/list-appointments.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingController {
  constructor(
    private readonly booking: BookingService,
    private readonly availability: AvailabilityService,
    private readonly waitlist: WaitlistService,
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

  @Post('appointments/create')
  @Roles('owner', 'manager', 'staff')
  @Permissions('appointment:create')
  async createAppointment(@Body() dto: CreateAppointmentDto) {
    return this.booking.createAppointment(dto);
  }

  @Get('availability')
  @Roles('owner', 'manager', 'staff', 'customer')
  @Permissions('appointment:read')
  async getAvailability(@Query() query: AvailabilityQueryDto) {
    return this.booking.getAvailability(query);
  }

  @Post('appointments/lock')
  @Roles('owner', 'manager', 'staff', 'customer')
  @Permissions('appointment:create')
  async lockSlot(@Body() dto: LockSlotDto) {
    return this.booking.lockSlot(dto);
  }

  @Post('appointments/confirm')
  @Roles('owner', 'manager', 'staff', 'customer')
  @Permissions('appointment:create')
  async confirmBooking(@Body() dto: ConfirmBookingDto) {
    return this.booking.confirmBooking(dto);
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

  @Post('appointments/confirm-from-waitlist')
  @Roles('owner', 'manager', 'staff', 'customer')
  @Permissions('appointment:create')
  async confirmFromWaitlist(@Body() dto: ConvertWaitlistDto) {
    const sessionId = await this.waitlist.getNotifiedSessionId(dto.waitlistId);
    if (!sessionId) {
      throw new Error('Waitlist reservation expired or invalid');
    }

    const confirmDto: ConfirmBookingDto = {
      businessId: dto.businessId,
      customerId: dto.customerId,
      staffId: dto.staffId,
      serviceId: dto.serviceId,
      date: dto.date,
      startTime: dto.startTime,
      sessionId,
      branchId: dto.branchId,
      locationId: dto.locationId,
    };

    const appointment = await this.booking.confirmBooking(confirmDto);
    await this.waitlist.markConverted(dto.waitlistId, appointment.id);
    return appointment;
  }
}
