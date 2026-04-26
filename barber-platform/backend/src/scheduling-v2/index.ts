/**
 * Scheduling v2 — interval availability + slot holds (see slot-hold.service.ts).
 */

export type { MsInterval } from './interval-types';
export {
  intervalFromDates,
  intervalToSlot,
  assertValidInterval,
} from './interval-types';
export { mergeIntervals, subtractIntervals, generateSlotsFromInterval } from './interval-math';
export type { ComputeAvailabilityInput, DateInterval } from './compute-availability';
export { computeAvailability } from './compute-availability';
export { SlotHoldService } from './slot-hold.service';
export { SchedulingV2Module } from './scheduling-v2.module';
