import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { enableRedis } from '../common/redis-config';
import { logRedisConnectionConfig, resolveRedisConnection } from '../common/redis-connection';

/** No-op queue when Redis disabled - add() resolves immediately, no jobs are processed */
function createNoOpQueue(): Queue {
  return {
    add: async () => ({ id: 'noop', name: '', data: {}, opts: {}, timestamp: 0, progress: 0, attemptsMade: 0, failedReason: undefined, stacktrace: [], returnvalue: null, finishedOn: undefined, processedOn: undefined }),
    close: async () => {},
  } as unknown as Queue;
}

@Injectable()
export class QueueService {
  readonly notificationQueue: Queue;
  readonly analyticsQueue: Queue;
  readonly automationQueue: Queue;

  constructor(private config: ConfigService) {
    if (!enableRedis) {
      this.notificationQueue = createNoOpQueue();
      this.analyticsQueue = createNoOpQueue();
      this.automationQueue = createNoOpQueue();
      return;
    }

    const notificationConnection = this.getConnection('queue.notification');
    const analyticsConnection = this.getConnection('queue.analytics');
    const automationConnection = this.getConnection('queue.automation');

    this.notificationQueue = new Queue('notification', { connection: notificationConnection });
    this.analyticsQueue = new Queue('analytics', { connection: analyticsConnection });
    this.automationQueue = new Queue('automation', { connection: automationConnection });
  }

  private getConnection(scope: 'queue.notification' | 'queue.analytics' | 'queue.automation') {
    const resolved = resolveRedisConnection(this.config, scope, {
      retryStrategy: () => null,
    });
    logRedisConnectionConfig(resolved);
    return resolved.options;
  }
}
