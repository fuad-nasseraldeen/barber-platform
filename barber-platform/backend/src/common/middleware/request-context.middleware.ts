import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { runWithContext } from '../request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId =
      (req.headers['x-request-id'] as string) ?? randomUUID();
    const user = req.user as { id?: string; sub?: string; businessId?: string } | undefined;
    const context = {
      requestId,
      tenantId: user?.businessId ?? req.body?.businessId ?? req.query?.businessId,
      userId: user?.id ?? user?.sub,
    };
    runWithContext(context, () => next());
  }
}
