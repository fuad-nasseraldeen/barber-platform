import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { enableRedis } from '../common/redis-config';

/** No-op queue when Redis disabled - add() resolves immediately, no jobs are processed */
function createNoOpQueue(): Queue {
  return {
    add: async () => ({ id: 'noop', name: '', data: {}, opts: {}, timestamp: 0, progress: 0, attemptsMade: 0, failedReason: undefined, stacktrace: [], returnvalue: null, finishedOn: undefined, processedOn: undefined }),
    close: async () => {},
  } as unknown as Queue;
}

@Injectable()
export class QueueService {
  readonly availabilityQueue: Queue;
  readonly notificationQueue: Queue;
  readonly analyticsQueue: Queue;
  readonly automationQueue: Queue;

  constructor(private config: ConfigService) {
    if (!enableRedis) {
      this.availabilityQueue = createNoOpQueue();
      this.notificationQueue = createNoOpQueue();
      this.analyticsQueue = createNoOpQueue();
      this.automationQueue = createNoOpQueue();
      return;
    }

    const connection = this.getConnection();

    this.availabilityQueue = new Queue('availability', { connection });
    this.notificationQueue = new Queue('notification', { connection });
    this.analyticsQueue = new Queue('analytics', { connection });
    this.automationQueue = new Queue('automation', { connection });
  }

  private getConnection() {
    const url = this.config.get('REDIS_URL');
    if (url) return { url, retryStrategy: () => null };
    return {
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD') || undefined,
      retryStrategy: () => null,
    };
  }
}
