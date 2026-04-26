import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { getRequestContext } from '../request-context';

/**
 * Updates request context with user info after auth guard has run.
 * Call from controllers or apply globally after auth.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as { id?: string; sub?: string; businessId?: string } | undefined;
    const ctx = getRequestContext();
    if (ctx && user) {
      if (!ctx.userId) ctx.userId = user.id ?? user.sub;
      if (!ctx.tenantId) ctx.tenantId = user.businessId;
    }
    return next.handle();
  }
}
