import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { BookingModule } from '../booking/booking.module';
import { QueueService } from './queue.service';

@Module({
  imports: [AvailabilityModule, BookingModule],
  providers: [QueueService],
  exports: [QueueService, AvailabilityModule, BookingModule],
})
export class QueuesModule {}
