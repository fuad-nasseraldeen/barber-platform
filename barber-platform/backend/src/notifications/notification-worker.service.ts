import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import { enableRedis } from '../common/redis-config';
import { logRedisConnectionConfig, resolveRedisConnection } from '../common/redis-connection';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { EmailService } from './email.service';
import { PushService } from './push.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationJobPayload } from './notification.types';

@Injectable()
export class NotificationWorkerService implements OnModuleDestroy {
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly email: EmailService,
    private readonly push: PushService,
    private readonly config: ConfigService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {
    const enableWorkers = enableRedis && this.config.get('ENABLE_QUEUE_WORKERS', 'true') !== 'false';
    if (enableWorkers) {
      const connection = this.getConnection();
      this.worker = new Worker(
        'notification',
        this.processJob.bind(this),
        { connection, concurrency: 5 },
      );
    }
  }

  async onModuleDestroy() {
    if (this.worker) await this.worker.close();
  }

  private async processJob(job: Job<NotificationJobPayload & { appointmentId?: string }>): Promise<void> {
    const payload = job.data;

    if (payload.trigger === 'appointment_reminder' && payload.appointmentId && !payload.customerId) {
      await this.processReminderJob(payload.appointmentId);
      return;
    }

    const notification = await this.prisma.notification.create({
      data: {
        businessId: payload.businessId,
        userId: payload.userId,
        customerId: payload.customerId,
        type: payload.trigger,
        title: payload.title,
        body: payload.body,
        data: (payload.data as object) ?? undefined,
        channel: 'IN_APP',
      },
    });

    const promises: Promise<void>[] = [];

    for (const ch of payload.channels) {
      if (ch === 'SMS' && payload.phone) {
        promises.push(
          this.sms.send(payload.phone, `${payload.title}. ${payload.body ?? ''}`).catch((e) => {
            console.error('[NotificationWorker] SMS failed:', e);
          }),
        );
      } else if (ch === 'EMAIL' && payload.email) {
        promises.push(
          this.email
            .send({
              to: payload.email,
              subject: payload.title,
              text: payload.body,
            })
            .catch((e) => {
              console.error('[NotificationWorker] Email failed:', e);
            }),
        );
      } else if (ch === 'PUSH' && payload.pushToken) {
        promises.push(
          this.push
            .send({
              token: payload.pushToken,
              title: payload.title,
              body: payload.body,
              data: payload.data as Record<string, string>,
            })
            .catch((e) => {
              console.error('[NotificationWorker] Push failed:', e);
            }),
        );
      }
    }

    await Promise.allSettled(promises);

    await this.prisma.notification.update({
      where: { id: notification.id },
      data: { sentAt: new Date() },
    });

    this.notificationsGateway.emitToBusiness(payload.businessId, 'notification', {
      id: notification.id,
      type: payload.trigger,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      createdAt: new Date().toISOString(),
    });
  }

  private async processReminderJob(appointmentId: string): Promise<void> {
    const apt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        customer: true,
        service: true,
        business: true,
      },
    });
    if (!apt) return;

    const startTime = apt.startTime.toISOString().slice(11, 16);

    const channels: ('SMS' | 'EMAIL' | 'PUSH')[] = [];
    if (apt.customer.phone) channels.push('SMS');
    if (apt.customer.email) channels.push('EMAIL');

    if (channels.length === 0) return;

    const title = 'Appointment reminder';
    const body = `Reminder: Your ${apt.service.name} appointment is tomorrow at ${startTime}.`;

    const notification = await this.prisma.notification.create({
      data: {
        businessId: apt.businessId,
        customerId: apt.customerId,
        type: 'appointment_reminder',
        title,
        body,
        data: { appointmentId },
        channel: 'IN_APP',
      },
    });

    const promises: Promise<void>[] = [];
    if (apt.customer.phone) {
      promises.push(
        this.sms.send(apt.customer.phone, `${title}. ${body}`).catch((e) => {
          console.error('[NotificationWorker] SMS reminder failed:', e);
        }),
      );
    }
    if (apt.customer.email) {
      promises.push(
        this.email
          .send({ to: apt.customer.email, subject: title, text: body })
          .catch((e) => {
            console.error('[NotificationWorker] Email reminder failed:', e);
          }),
      );
    }

    await Promise.allSettled(promises);

    await this.prisma.notification.update({
      where: { id: notification.id },
      data: { sentAt: new Date() },
    });

    this.notificationsGateway.emitToBusiness(apt.businessId, 'notification', {
      id: notification.id,
      type: 'appointment_reminder',
      title,
      body,
      data: { appointmentId },
      createdAt: new Date().toISOString(),
    });
  }

  private getConnection() {
    const resolved = resolveRedisConnection(this.config, 'worker.notification');
    logRedisConnectionConfig(resolved);
    return resolved.options;
  }
}
