import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityWorkerService } from './availability-worker.service';
import { AvailabilitySchedulerService } from './availability-scheduler.service';

@Module({
  providers: [
    AvailabilityService,
    AvailabilityWorkerService,
    AvailabilitySchedulerService,
  ],
  exports: [AvailabilityService, AvailabilityWorkerService],
})
export class AvailabilityModule {}
