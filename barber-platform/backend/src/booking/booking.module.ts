import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { AvailabilityModule } from '../availability/availability.module';
import { StaffModule } from '../staff/staff.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerVisitsModule } from '../customer-visits/customer-visits.module';
import { forwardRef } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [
    AvailabilityModule,
    StaffModule,
    WaitlistModule,
    NotificationsModule,
    CustomerVisitsModule,
    forwardRef(() => AutomationModule),
  ],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
