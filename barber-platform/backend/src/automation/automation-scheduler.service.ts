import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queues/queue.service';
import { bullmqSafeJobId } from '../common/bullmq-job-id';
import { isSchedulerPrimaryInstance } from '../common/scheduler-instance';
import { TimeSlotService } from '../availability/time-slot.service';
import { AvailabilityOverlayService } from '../availability/availability-overlay.service';
import { AvailabilityHotCacheService } from '../availability/availability-hot-cache.service';

@Injectable()
export class AutomationSchedulerService {
  private readonly logger = new Logger(AutomationSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly timeSlots: TimeSlotService,
    private readonly availabilityOverlay: AvailabilityOverlayService,
    private readonly hotAvailabilityCache: AvailabilityHotCacheService,
  ) {}

  /**
   * Run daily at 9:00 AM - enqueue birthday message jobs for all active rules.
   */
  @Cron('0 9 * * *', { timeZone: 'UTC' })
  async scheduleBirthdayMessages() {
    if (!isSchedulerPrimaryInstance()) return;
    try {
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
    } catch (err) {
      this.logger.warn(
        `scheduleBirthdayMessages skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Purge expired slot holds every 30 seconds.
   * Keeps the EXCLUDE index lean and prevents orphan holds from blocking new reservations.
   * Previously ran inline on every createSlotHold call — moved here to cut per-request latency.
   */
  @Cron('*/30 * * * * *')
  async cleanupExpiredSlotHolds() {
    if (!isSchedulerPrimaryInstance()) return;
    try {
      const now = new Date();
      const overlayExpired = await this.availabilityOverlay.cleanupExpiredHolds();
      await this.timeSlots.releaseExpiredHolds();
      await this.prisma.$executeRaw`
        DELETE FROM "slot_holds" AS sh
        WHERE sh.expires_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM "appointments" AS a WHERE a."slotHoldId" = sh.id
        )
      `;

      const affectedDays = new Map<string, { businessId: string; staffId: string; dateYmd: string }>();
      for (const item of overlayExpired) {
        affectedDays.set(
          `${item.businessId}:${item.staffId}:${item.dateYmd}`,
          item,
        );
      }

      await Promise.all(
        [...affectedDays.values()].map((item) =>
          this.hotAvailabilityCache.refreshCachedServicesForDay(
            item.businessId,
            item.staffId,
            item.dateYmd,
          ),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `cleanupExpiredSlotHolds: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Run every hour - enqueue scheduled_message jobs that are due.
   */
  @Cron('0 * * * *', { timeZone: 'UTC' })
  async scheduleScheduledMessages() {
    if (!isSchedulerPrimaryInstance()) return;
    try {
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
              jobId: bullmqSafeJobId('scheduled', rule.id, actions.sendAt),
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
                jobId: bullmqSafeJobId(
                  'scheduled',
                  rule.id,
                  now.toISOString().slice(0, 13),
                ),
                removeOnComplete: { count: 100 },
              },
            );
          }
        }
      }
    }
    } catch (err) {
      this.logger.warn(
        `scheduleScheduledMessages skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
