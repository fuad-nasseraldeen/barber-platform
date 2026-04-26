import { Module, forwardRef } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { BookingValidationService } from './booking-validation.service';
import { BookingMetricsService } from './metrics.service';
import { BookingPerfInterceptor } from '../common/interceptors/booking-perf.interceptor';
import { JsonSerializeTimingInterceptor } from '../common/interceptors/json-serialize-timing.interceptor';
import { AvailabilityTimingInterceptor } from '../common/interceptors/availability-timing.interceptor';
import { AvailabilityModule } from '../availability/availability.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerVisitsModule } from '../customer-visits/customer-visits.module';
import { AutomationModule } from '../automation/automation.module';
import { SchedulingV2Module } from '../scheduling-v2/scheduling-v2.module';
import { BookingRescheduleProjectionWorkerService } from './booking-reschedule-projection.worker.service';
import { BookingEngineBootStatusService } from './booking-engine-boot-status.service';

@Module({
  imports: [
    SchedulingV2Module,
    AvailabilityModule,
    WaitlistModule,
    NotificationsModule,
    CustomerVisitsModule,
    forwardRef(() => AutomationModule),
  ],
  controllers: [BookingController],
  providers: [
    BookingService,
    BookingValidationService,
    BookingMetricsService,
    BookingPerfInterceptor,
    JsonSerializeTimingInterceptor,
    AvailabilityTimingInterceptor,
    BookingRescheduleProjectionWorkerService,
    BookingEngineBootStatusService,
  ],
  exports: [BookingService, BookingValidationService, BookingMetricsService],
})
export class BookingModule {}
