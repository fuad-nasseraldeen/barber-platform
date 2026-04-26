import { Module } from '@nestjs/common';
import { ComputedAvailabilityService } from './computed-availability.service';
import { AvailabilityMetricsService } from './availability-metrics.service';
import { StaffReadinessValidatorService } from './staff-readiness-validator.service';
import { AvailabilityDebugService } from './availability-debug.service';
import { AvailabilitySlotDebugService } from './availability-slot-debug.service';
import { TimeSlotService } from './time-slot.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AvailabilityHotCacheService } from './availability-hot-cache.service';
import { AvailabilityOverlayService } from './availability-overlay.service';
import { TimeSlotProjectionLifecycleService } from './time-slot-projection-lifecycle.service';

@Module({
  imports: [PrismaModule],
  providers: [
    ComputedAvailabilityService,
    AvailabilityMetricsService,
    StaffReadinessValidatorService,
    AvailabilityDebugService,
    AvailabilitySlotDebugService,
    TimeSlotService,
    AvailabilityHotCacheService,
    AvailabilityOverlayService,
    TimeSlotProjectionLifecycleService,
  ],
  exports: [
    ComputedAvailabilityService,
    AvailabilityMetricsService,
    StaffReadinessValidatorService,
    AvailabilityDebugService,
    AvailabilitySlotDebugService,
    TimeSlotService,
    AvailabilityHotCacheService,
    AvailabilityOverlayService,
    TimeSlotProjectionLifecycleService,
  ],
})
export class AvailabilityModule {}
