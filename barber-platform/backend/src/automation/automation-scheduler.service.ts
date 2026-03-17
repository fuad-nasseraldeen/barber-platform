import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queues/queue.service';

@Injectable()
export class AutomationSchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  /**
   * Run daily at 9:00 AM - enqueue birthday message jobs for all active rules.
   */
  @Cron('0 9 * * *', { timeZone: 'UTC' })
  async scheduleBirthdayMessages() {
    const rules = await this.prisma.automationRule.findMany({
      where: {
        isActive: true,
        triggerType: 'birthday_message',
      },
    });

    for (const rule of rules) {
      await this.queues.automationQueue.add(
        'birthday_message',
        {
          ruleId: rule.id,
          businessId: rule.businessId,
          triggerType: 'birthday_message',
        },
        {
          jobId: `birthday:${rule.id}:${new Date().toISOString().slice(0, 10)}`,
          removeOnComplete: { count: 100 },
        },
      );
    }
  }

  /**
   * Run every hour - enqueue scheduled_message jobs that are due.
   */
  @Cron('0 * * * *', { timeZone: 'UTC' })
  async scheduleScheduledMessages() {
    const rules = await this.prisma.automationRule.findMany({
      where: {
        isActive: true,
        triggerType: 'scheduled_message',
      },
    });

    const now = new Date();
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);

    for (const rule of rules) {
      const actions = rule.actions as { scheduleCron?: string; sendAt?: string } | null;
      if (!actions) continue;

      if (actions.sendAt) {
        const sendAt = new Date(actions.sendAt);
        if (sendAt <= now && sendAt >= new Date(hourStart.getTime() - 60 * 60 * 1000)) {
          await this.queues.automationQueue.add(
            'scheduled_message',
            {
              ruleId: rule.id,
              businessId: rule.businessId,
              triggerType: 'scheduled_message',
              sendAt: actions.sendAt,
            },
            {
              jobId: `scheduled:${rule.id}:${actions.sendAt}`,
              removeOnComplete: { count: 100 },
            },
          );
        }
      } else if (actions.scheduleCron) {
        const cronParts = actions.scheduleCron.split(' ');
        if (cronParts.length >= 5) {
          const [min, hour] = cronParts;
          const currentHour = now.getUTCHours();
          const currentMin = now.getUTCMinutes();
          const cronHour = hour === '*' ? currentHour : parseInt(hour, 10);
          const cronMin = min === '*' ? currentMin : parseInt(min, 10);
          if (cronHour === currentHour && cronMin === currentMin) {
            await this.queues.automationQueue.add(
              'scheduled_message',
              {
                ruleId: rule.id,
                businessId: rule.businessId,
                triggerType: 'scheduled_message',
              },
              {
                jobId: `scheduled:${rule.id}:${now.toISOString().slice(0, 13)}`,
                removeOnComplete: { count: 100 },
              },
            );
          }
        }
      }
    }
  }
}
