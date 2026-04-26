/** Filled by {@link ComputedAvailabilityService.getAvailabilityDayMap} when caller passes `timingHeaderSink`. */
export interface AvailabilityDayMapTimingHeader {
  path: string;
  totalMs: number;
  redisMs: number;
  /** Number of Redis/cache calls observed during this GET /availability request. */
  redisCallCount?: number;
  /** Approximate Redis payload size (bytes) read/written during this request. */
  payloadSizeBytes?: number;
  /** Number of Redis keys touched (mget/set scope) for this request. */
  keysPerRequest?: number;
  dbMs: number;
  busyPrepMs: number;
  computeMs: number;
  remainderMs?: number;
}

/** Serialized to JSON in `X-Availability-Timing` when `AVAILABILITY_TIMING_RESPONSE_HEADER=1`. */
export interface GetAvailabilityHttpTiming {
  /**
   * When false, numeric fields are not yet set — do not treat as measured zeros.
   * Set true after {@link BookingService.getAvailability} finishes.
   */
  populated: boolean;
  dayMap: AvailabilityDayMapTimingHeader;
  envelope: {
    totalMs: number;
    bookingBusinessTzMs: number;
    dayMapCallMs: number;
    bookingAfterDayMapMs: number;
  };
}
