import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import {
  getPrismaMiddlewareQueryRecords,
  getRedisCallCount,
} from '../request-context';
import type { GetAvailabilityHttpTiming } from '../../availability/availability-http-timing.types';

/**
 * When LOG_AVAILABILITY_TIMING=1, logs:
 *   LOGIC_MS — time until handler returns (service work + small Nest overhead)
 *   SERIALIZE_MS — JSON.stringify(payload) only (Nest will serialize again when sending)
 */
@Injectable()
export class AvailabilityTimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const shouldLog = process.env.LOG_AVAILABILITY_TIMING === '1';
    if (!shouldLog) {
      return next.handle();
    }
    const t0 = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          // Keep existing timing signal.
          console.log('[availability-timing] LOGIC_MS:', Date.now() - t0);
        },
      }),
      map((data) => {
        const t1 = Date.now();
        try {
          JSON.stringify(data);
        } catch {
          // ignore
        }
        const serializeMs = Date.now() - t1;
        console.log('[availability-timing] SERIALIZE_MS:', serializeMs);

        const req = context.switchToHttp().getRequest<{
          query?: Record<string, unknown>;
        }>();
        const res = context.switchToHttp().getResponse<{
          getHeader(name: string): unknown;
        }>();
        const rawTimingHeader = res.getHeader('X-Availability-Timing');
        let timing: GetAvailabilityHttpTiming | null = null;
        if (typeof rawTimingHeader === 'string' && rawTimingHeader.length > 0) {
          try {
            timing = JSON.parse(rawTimingHeader) as GetAvailabilityHttpTiming;
          } catch {
            timing = null;
          }
        }

        const totalMs =
          (timing?.envelope?.totalMs ?? Date.now() - t0) + serializeMs;
        const dbMs =
          (timing?.dayMap?.dbMs ?? 0) + (timing?.envelope?.bookingBusinessTzMs ?? 0);
        const redisMs = timing?.dayMap?.redisMs ?? 0;
        const slotBuildMs = timing?.dayMap?.computeMs ?? 0;
        const validationMs = 0;
        const queries = getPrismaMiddlewareQueryRecords();

        console.log(
          JSON.stringify({
            type: 'AVAILABILITY_PERF',
            AVAILABILITY_TOTAL_MS: Math.round(totalMs),
            AVAILABILITY_DB_MS: Math.round(dbMs),
            AVAILABILITY_REDIS_MS: Math.round(redisMs),
            AVAILABILITY_SLOT_BUILD_MS: Math.round(slotBuildMs),
            AVAILABILITY_VALIDATION_MS: Math.round(validationMs),
            AVAILABILITY_SERIALIZE_MS: Math.round(serializeMs),
            numberOfQueries: queries.length,
            numberOfRedisCalls: getRedisCallCount(),
            businessId:
              typeof req?.query?.businessId === 'string' ? req.query.businessId : undefined,
            staffId:
              typeof req?.query?.staffId === 'string' ? req.query.staffId : undefined,
            date:
              typeof req?.query?.date === 'string'
                ? req.query.date.slice(0, 10)
                : undefined,
          }),
        );
        return data;
      }),
    );
  }
}
