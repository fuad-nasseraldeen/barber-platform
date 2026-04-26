import { performance } from 'node:perf_hooks';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { finalize, map, tap } from 'rxjs/operators';
import { BOOKING_PERF_ENDPOINT } from '../decorators/booking-perf.decorator';
import { writeHotPathPerfNdjson, writePerfNdjson } from '../perf-ndjson';
import {
  getPrismaMiddlewareQueryRecords,
  getPrismaQueryDurationMs,
  resetPrismaQueryDurationMs,
  setRequestEndpoint,
} from '../request-context';

/**
 * For handlers decorated with `@BookingPerfEndpoint`, measures wall time and Prisma `$use` duration
 * (middleware is always registered — see PrismaService).
 *
 * When `BOOKING_PERF_LOG=1`, emits NDJSON:
 * `{ endpoint, durationMs, success, dbDurationMs, queryCount, queries[], warnings? }` plus requestId/tenantId/userId.
 * When `HOT_PATH_PERF_LOG=1`, emits a slim `{ type:'hot_path', endpoint, durationMs, dbDurationMs, success }` line.
 *
 * `durationMs` spans handler + inner interceptors until the response observable completes (not raw network I/O).
 * `dbDurationMs` sums Prisma client operation wall time (Redis not included).
 */
@Injectable()
export class BookingPerfInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const endpoint = this.reflector.get<string | undefined>(
      BOOKING_PERF_ENDPOINT,
      context.getHandler(),
    );
    if (!endpoint) {
      return next.handle();
    }

    resetPrismaQueryDurationMs();
    setRequestEndpoint(endpoint);
    const t0 = performance.now();
    let success = true;
    let serializeMs = 0;

    return next.handle().pipe(
      tap({
        next: () => {
          success = true;
        },
        error: () => {
          success = false;
        },
      }),
      map((data) => {
        const s0 = performance.now();
        try {
          JSON.stringify(data);
        } catch {
          /* ignore: circular / BigInt — same probe as JsonSerializeTimingInterceptor */
        }
        serializeMs = performance.now() - s0;
        return data;
      }),
      finalize(() => {
        const durationMs = Math.round(performance.now() - t0);
        const dbMs = getPrismaQueryDurationMs() ?? 0;
        const queries = getPrismaMiddlewareQueryRecords();
        const queryCount = queries.length;
        const line: Record<string, unknown> = {
          endpoint,
          durationMs,
          serializeMs: Math.round(serializeMs),
          success,
          queryCount,
          queries: queries.map((q) => ({ ...q })),
          dbDurationMs: dbMs,
        };
        const warnings: string[] = [];
        if (queryCount > 20) warnings.push('query_count_gt_20');
        if (queries.some((q) => q.durationMs > 500)) {
          warnings.push('slow_prisma_query_gt_500ms');
        }
        if (warnings.length) line.warnings = warnings;
        writePerfNdjson(line);
        writeHotPathPerfNdjson({
          type: 'hot_path',
          endpoint,
          durationMs,
          dbDurationMs: dbMs,
          success,
        });
      }),
    );
  }
}
