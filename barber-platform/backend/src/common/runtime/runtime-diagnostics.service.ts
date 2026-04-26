import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpConcurrencyTracker } from './http-concurrency.tracker';

/**
 * Cheap runtime signals: event-loop scheduling lag (CPU/blocking hint) + HTTP in-flight from tracker.
 * Prisma pool depth is not exposed by PrismaClient — watch logs for pool timeout (P2024) instead.
 */
@Injectable()
export class RuntimeDiagnosticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeDiagnosticsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly startedAt = Date.now();

  /** Last sample: drift of setInterval wall clock vs expected (ms). */
  lastEventLoopLagMs = 0;

  /** High water mark since process start (ms). */
  maxEventLoopLagMs = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly tracker: HttpConcurrencyTracker,
  ) {}

  onModuleInit(): void {
    const interval = parseInt(
      this.config.get<string>('RUNTIME_EVENT_LOOP_SAMPLE_MS') || '5000',
      10,
    );
    const warnLag = parseInt(
      this.config.get<string>('RUNTIME_EVENT_LOOP_WARN_MS') || '100',
      10,
    );
    if (interval <= 0) return;

    let prev = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const drift = Math.max(0, now - prev - interval);
      prev = now;
      this.lastEventLoopLagMs = drift;
      this.maxEventLoopLagMs = Math.max(this.maxEventLoopLagMs, drift);
      if (drift >= warnLag) {
        this.logger.warn(
          `event_loop_lag_ms=${drift.toFixed(0)} http_in_flight=${this.tracker.getInFlight()} pid=${process.pid}`,
        );
      }
    }, interval);

    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getSnapshot(): Record<string, number | string> {
    return {
      pid: process.pid,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      httpInFlight: this.tracker.getInFlight(),
      lastEventLoopLagMs: this.lastEventLoopLagMs,
      maxEventLoopLagMsSinceStart: this.maxEventLoopLagMs,
    };
  }
}
