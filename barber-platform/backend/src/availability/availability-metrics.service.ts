import { Injectable } from '@nestjs/common';

export interface AvailabilityGapSample {
  staffId: string;
  date: string;
}

export interface AvailabilityMetricsAggregate {
  availabilityQueryCount: number;
  availabilityCacheHitCount: number;
  availabilityCacheMissCount: number;
  availabilityDbTimeMsTotal: number;
  /** Layer-1 busy-interval cache (per calendar day). */
  availabilityBusyDayHitCount: number;
  availabilityBusyDayMissCount: number;
  /** Full-day slot grid cache (`av:day:*`) — day-granularity hits / misses per request. */
  availabilityFullDayCacheHitDays: number;
  availabilityFullDayCacheMissDays: number;
  /** Pure slot generation + ranking after busy data resolved (no DB). */
  availabilitySlotComputeMsTotal: number;
  availabilitySlotComputeCount: number;
  availabilityEndpointCount: number;
  availabilityEndpointTimeMsTotal: number;
  /** Legacy counter (slot precompute removed); kept for metrics shape compatibility. */
  availabilityGapDetectionTotal: number;
  /** GET /availability served from `time_slots` table (`USE_TIME_SLOTS=1`). */
  availabilityReadPathTimeSlotsCount: number;
  /** GET /availability served from computed cache/DB path. */
  availabilityReadPathComputedCount: number;
}

const globalAgg: AvailabilityMetricsAggregate = {
  availabilityQueryCount: 0,
  availabilityCacheHitCount: 0,
  availabilityCacheMissCount: 0,
  availabilityDbTimeMsTotal: 0,
  availabilityBusyDayHitCount: 0,
  availabilityBusyDayMissCount: 0,
  availabilityFullDayCacheHitDays: 0,
  availabilityFullDayCacheMissDays: 0,
  availabilitySlotComputeMsTotal: 0,
  availabilitySlotComputeCount: 0,
  availabilityEndpointCount: 0,
  availabilityEndpointTimeMsTotal: 0,
  availabilityGapDetectionTotal: 0,
  availabilityReadPathTimeSlotsCount: 0,
  availabilityReadPathComputedCount: 0,
};

const MAX_GAP_BUFFER = 500;

/** In-process metrics for availability reads (DB + cache + handler). Swap for Prometheus in production. */
@Injectable()
export class AvailabilityMetricsService {
  private readonly gapWindow: AvailabilityGapSample[] = [];

  /** No-op path retained for API compatibility. */
  recordAvailabilityGap(staffId: string, date: string): void {
    globalAgg.availabilityGapDetectionTotal++;
    this.gapWindow.push({ staffId, date });
    if (this.gapWindow.length > MAX_GAP_BUFFER) {
      this.gapWindow.splice(0, this.gapWindow.length - MAX_GAP_BUFFER);
    }
  }

  /**
   * Scheduler: drain recent gap samples for alerting (avoids log spam per request).
   */
  pollGapsForAlert(): { count: number; samples: AvailabilityGapSample[] } {
    const samples = this.gapWindow.splice(0, this.gapWindow.length);
    return {
      count: samples.length,
      samples: samples.slice(0, 25),
    };
  }

  recordSlotQuery(dbMs: number, cacheHit: boolean): void {
    globalAgg.availabilityQueryCount++;
    globalAgg.availabilityDbTimeMsTotal += dbMs;
    if (cacheHit) globalAgg.availabilityCacheHitCount++;
    else globalAgg.availabilityCacheMissCount++;
  }

  recordBusyDayCache(hit: boolean): void {
    if (hit) globalAgg.availabilityBusyDayHitCount++;
    else globalAgg.availabilityBusyDayMissCount++;
  }

  /** Per getAvailabilityDayMap: how many calendar days were served from full-day Redis vs freshly computed. */
  recordFullDayCacheDays(hitDays: number, missDays: number): void {
    globalAgg.availabilityFullDayCacheHitDays += hitDays;
    globalAgg.availabilityFullDayCacheMissDays += missDays;
  }

  recordSlotComputeMs(ms: number): void {
    globalAgg.availabilitySlotComputeMsTotal += ms;
    globalAgg.availabilitySlotComputeCount++;
  }

  recordEndpointDuration(ms: number): void {
    globalAgg.availabilityEndpointCount++;
    globalAgg.availabilityEndpointTimeMsTotal += ms;
  }

  /** Which read model served GET /availability (for p95 comparison: time_slots vs computed). */
  recordAvailabilityReadPath(path: 'time_slots' | 'computed'): void {
    if (path === 'time_slots') globalAgg.availabilityReadPathTimeSlotsCount++;
    else globalAgg.availabilityReadPathComputedCount++;
  }

  getSnapshot(): AvailabilityMetricsAggregate & {
    availabilityDbTimeMsAvg: number;
    availabilityEndpointTimeMsAvg: number;
    availabilityCacheHitRatio: number;
    availabilityBusyDayHitRatio: number;
    availabilityFullDayHitRatio: number;
    availabilitySlotComputeMsAvg: number;
    availabilityTimeSlotsPathShare: number;
  } {
    const q = globalAgg.availabilityQueryCount || 1;
    const e = globalAgg.availabilityEndpointCount || 1;
    const ts = globalAgg.availabilityReadPathTimeSlotsCount;
    const cp = globalAgg.availabilityReadPathComputedCount;
    const pathTotal = ts + cp || 1;
    const hits = globalAgg.availabilityCacheHitCount;
    const misses = globalAgg.availabilityCacheMissCount;
    const hm = hits + misses || 1;
    const bh = globalAgg.availabilityBusyDayHitCount;
    const bm = globalAgg.availabilityBusyDayMissCount;
    const bhm = bh + bm || 1;
    const fh = globalAgg.availabilityFullDayCacheHitDays;
    const fm = globalAgg.availabilityFullDayCacheMissDays;
    const fhm = fh + fm || 1;
    const sc = globalAgg.availabilitySlotComputeCount || 1;
    return {
      ...globalAgg,
      availabilityDbTimeMsAvg: globalAgg.availabilityDbTimeMsTotal / q,
      availabilityEndpointTimeMsAvg:
        globalAgg.availabilityEndpointTimeMsTotal / e,
      availabilityCacheHitRatio: hits / hm,
      availabilityBusyDayHitRatio: bh / bhm,
      availabilityFullDayHitRatio: fh / fhm,
      availabilitySlotComputeMsAvg: globalAgg.availabilitySlotComputeMsTotal / sc,
      availabilityTimeSlotsPathShare: ts / pathTotal,
    };
  }
}
