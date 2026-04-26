import { SetMetadata } from '@nestjs/common';

export const BOOKING_PERF_ENDPOINT = 'booking_perf_endpoint';

/** Marks a handler for {@link BookingPerfInterceptor} structured latency logs (requires BOOKING_PERF_LOG=1). */
export function BookingPerfEndpoint(endpoint: string) {
  return SetMetadata(BOOKING_PERF_ENDPOINT, endpoint);
}
