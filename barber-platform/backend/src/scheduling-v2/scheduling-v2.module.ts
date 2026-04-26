import { Module } from '@nestjs/common';
import { SlotHoldService } from './slot-hold.service';

/**
 * Scheduling v2 — interval availability (pure TS) + DB-backed slot holds.
 * Import `SchedulingV2Module` from AppModule when wiring HTTP controllers.
 */
@Module({
  providers: [SlotHoldService],
  exports: [SlotHoldService],
})
export class SchedulingV2Module {}
