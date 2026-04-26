import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { HttpConcurrencyTracker } from './http-concurrency.tracker';

/**
 * Heavy reporting endpoints can exceed HTTP_REQUEST_TIMEOUT_MS; sending 503 from the timer while
 * Nest still resolves the handler causes ERR_HTTP_HEADERS_SENT when ExpressAdapter tries res.json(200).
 */
function shouldSkipRequestTimeout(req: Request): boolean {
  const u = req.originalUrl ?? req.url ?? '';
  return u.includes('schedule-snapshot');
}

/**
 * In-process backpressure: 503 when too many requests are in-flight (no extra deps).
 * Health routes should stay excluded so k6/probes can still detect liveness.
 */
@Injectable()
export class HttpConcurrencyMiddleware implements NestMiddleware {
  constructor(
    private readonly config: ConfigService,
    private readonly tracker: HttpConcurrencyTracker,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const max = parseInt(
      this.config.get<string>('HTTP_MAX_CONCURRENT_REQUESTS') || '0',
      10,
    );
    const timeoutMs = parseInt(
      this.config.get<string>('HTTP_REQUEST_TIMEOUT_MS') || '0',
      10,
    );

    if (max > 0 && this.tracker.getInFlight() >= max) {
      if (!res.headersSent) {
        res.setHeader('Retry-After', '2');
        res.status(503).json({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Server at capacity — too many concurrent requests',
        });
      }
      return;
    }

    if (timeoutMs > 0 && !shouldSkipRequestTimeout(req)) {
      const timer = setTimeout(() => {
        if (res.headersSent || res.writableEnded) return;
        try {
          res.status(503).json({
            statusCode: 503,
            error: 'Service Unavailable',
            message: 'Request timed out',
          });
        } catch {
          /* response may already be finishing */
        }
      }, timeoutMs);
      const clearTimer = () => clearTimeout(timer);
      res.once('finish', clearTimer);
      res.once('close', clearTimer);
    }

    this.tracker.enter();
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      this.tracker.leave();
    };
    res.on('finish', leave);
    res.on('close', leave);

    next();
  }
}
