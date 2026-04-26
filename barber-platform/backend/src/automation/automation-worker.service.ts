import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import { enableRedis } from '../common/redis-config';
import { logRedisConnectionConfig, resolveRedisConnection } from '../common/redis-connection';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { EmailService } from '../notifications/email.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import type { AutomationJobPayload } from './automation.types';

@Injectable()
export class AutomationWorkerService implements OnModuleDestroy {
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {
    const enableWorkers = enableRedis && this.config.get('ENABLE_QUEUE_WORKERS', 'true') !== 'false';
    if (enableWorkers) {
      const connection = this.getConnection();
      this.worker = new Worker(
        'automation',
        this.processJob.bind(this),
        { connection, concurrency: 3 },
      );
    }
  }

  async onModuleDestroy() {
    if (this.worker) await this.worker.close();
  }

  private async processJob(job: Job<AutomationJobPayload>): Promise<void> {
    const { triggerType, ruleId, businessId } = job.data;

    switch (triggerType) {
      case 'birthday_message':
        await this.processBirthdayMessage(ruleId, businessId);
        break;
      case 'appointment_reminder':
        await this.processAppointmentReminder(job.data);
        break;
      case 'scheduled_message':
        await this.processScheduledMessage(job.data);
        break;
      default:
        console.warn(`[AutomationWorker] Unknown trigger: ${triggerType}`);
    }
  }

  private async processBirthdayMessage(ruleId: string, businessId: string): Promise<void> {
    const rule = await this.prisma.automationRule.findUnique({
      where: { id: ruleId, businessId, isActive: true },
    });
    if (!rule) return;

    const actions = rule.actions as { channels?: string[]; messageTemplate?: string } | null;
    if (!actions?.channels?.length || !actions?.messageTemplate) return;

    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();

    const customers = await this.prisma.customer.findMany({
      where: {
        businessId,
        birthDate: { not: null },
        deletedAt: null,
        isActive: true,
      },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, birthDate: true },
    });

    for (const c of customers) {
      if (!c.birthDate) continue;
      const bd = new Date(c.birthDate);
      if (bd.getMonth() + 1 !== month || bd.getDate() !== day) continue;

      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Valued Customer';
      const message = actions.messageTemplate.replace(/\{\{name\}\}/g, name);

      if (actions.channels.includes('IN_APP')) {
        await this.sendInAppNotification(businessId, c.id, 'Happy Birthday!', message, {
          customerId: c.id,
          type: 'birthday_message',
        });
      }
      if (c.phone && actions.channels.includes('SMS')) {
        await this.sms.send(c.phone, message).catch((e) =>
          console.error('[AutomationWorker] Birthday SMS failed:', e),
        );
      }
      if (c.email && actions.channels.includes('EMAIL')) {
        await this.email
          .send({ to: c.email, subject: 'Happy Birthday!', text: message })
          .catch((e) => console.error('[AutomationWorker] Birthday email failed:', e));
      }
    }
  }

  private async processAppointmentReminder(data: AutomationJobPayload): Promise<void> {
    const { ruleId, businessId, appointmentId } = data;
    if (!appointmentId) return;

    const rule = await this.prisma.automationRule.findUnique({
      where: { id: ruleId, businessId, isActive: true },
    });
    if (!rule) return;

    const apt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        customer: true,
        service: true,
      },
    });
    if (!apt || apt.status === 'CANCELLED' || apt.status === 'NO_SHOW') return;

    const actions = rule.actions as {
      channels?: string[];
      messageTemplate?: string;
    } | null;
    const template = actions?.messageTemplate ?? `Reminder: Your {{serviceName}} appointment is at {{startTime}}.`;
    const customerName = apt.customer.firstName ?? apt.customer.lastName ?? 'there';
    const startTime = apt.startTime.toISOString().slice(11, 16);
    const message = template
      .replace(/\{\{name\}\}/g, customerName)
      .replace(/\{\{serviceName\}\}/g, apt.service.name)
      .replace(/\{\{startTime\}\}/g, startTime);

    const channels = actions?.channels ?? ['SMS', 'EMAIL'];
    if (apt.customer.phone && channels.includes('SMS')) {
      await this.sms.send(apt.customer.phone, message).catch((e) =>
        console.error('[AutomationWorker] Reminder SMS failed:', e),
      );
    }
    if (apt.customer.email && channels.includes('EMAIL')) {
      await this.email
        .send({ to: apt.customer.email, subject: 'Appointment Reminder', text: message })
        .catch((e) => console.error('[AutomationWorker] Reminder email failed:', e));
    }

    await this.sendInAppNotification(businessId, apt.customerId, 'Appointment reminder', message, {
      appointmentId,
      type: 'appointment_reminder',
    });
  }

  private async processScheduledMessage(data: AutomationJobPayload): Promise<void> {
    const { ruleId, businessId } = data;

    const rule = await this.prisma.automationRule.findUnique({
      where: { id: ruleId, businessId, isActive: true },
    });
    if (!rule) return;

    const actions = rule.actions as { channels?: string[]; messageTemplate?: string } | null;
    if (!actions?.channels?.length || !actions?.messageTemplate) return;

    const customers = await this.prisma.customer.findMany({
      where: { businessId, deletedAt: null, isActive: true },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });

    for (const c of customers) {
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Valued Customer';
      const message = actions.messageTemplate.replace(/\{\{name\}\}/g, name);

      if (c.phone && actions.channels.includes('SMS')) {
        await this.sms.send(c.phone, message).catch((e) =>
          console.error('[AutomationWorker] Scheduled SMS failed:', e),
        );
      }
      if (c.email && actions.channels.includes('EMAIL')) {
        await this.email
          .send({ to: c.email, subject: 'Message from us', text: message })
          .catch((e) => console.error('[AutomationWorker] Scheduled email failed:', e));
      }
    }
  }

  private async sendInAppNotification(
    businessId: string,
    customerId: string,
    title: string,
    body: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const notification = await this.prisma.notification.create({
      data: {
        businessId,
        customerId,
        type: 'automation',
        title,
        body,
        data: data as object,
        channel: 'IN_APP',
      },
    });

    this.notificationsGateway.emitToBusiness(businessId, 'notification', {
      id: notification.id,
      type: 'automation',
      title,
      body,
      data,
      createdAt: new Date().toISOString(),
    });
  }

  private getConnection() {
    const resolved = resolveRedisConnection(this.config, 'worker.automation');
    logRedisConnectionConfig(resolved);
    return resolved.options;
  }
}
