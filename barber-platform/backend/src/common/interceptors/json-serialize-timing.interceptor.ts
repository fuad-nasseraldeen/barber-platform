import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * When LOG_JSON_SERIALIZE_MS=1, measures JSON.stringify(payload) cost (approximates Nest response serialization).
 * Enable temporarily under load to spot large payloads; disable in production by default.
 */
@Injectable()
export class JsonSerializeTimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (process.env.LOG_JSON_SERIALIZE_MS !== '1') {
          return data;
        }
        const start = Date.now();
        try {
          JSON.stringify(data);
        } catch {
          // ignore
        }
        const ms = Date.now() - start;
        const req = context.switchToHttp().getRequest<{ url?: string }>();
        const label = `${context.getClass().name}.${context.getHandler().name}`;
        console.log(`[json-serialize-ms] ${ms}ms ${label} ${req?.url ?? ''}`);
        return data;
      }),
    );
  }
}
