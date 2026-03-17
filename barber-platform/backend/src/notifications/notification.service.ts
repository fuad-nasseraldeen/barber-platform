import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { enableRedis } from '../common/redis-config';
import { NotificationJobPayload } from './notification.types';

/** No-op queue when Redis disabled */
function createNoOpQueue(): Queue {
  return {
    add: async () => ({ id: 'noop', name: '', data: {}, opts: {}, timestamp: 0, progress: 0, attemptsMade: 0, failedReason: undefined, stacktrace: [], returnvalue: null, finishedOn: undefined, processedOn: undefined }),
  } as unknown as Queue;
}

@Injectable()
export class NotificationService {
  private notificationQueue: Queue;

  constructor(private readonly config: ConfigService) {
    if (!enableRedis) {
      this.notificationQueue = createNoOpQueue();
      return;
    }
    const connection = this.getConnection();
    this.notificationQueue = new Queue('notification', { connection });
  }

  private getConnection() {
    const url = this.config.get('REDIS_URL');
    if (url) return { url, retryStrategy: () => null };
    return {
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: parseInt(this.config.get('REDIS_PORT', '6379'), 10),
      password: this.config.get('REDIS_PASSWORD') || undefined,
      retryStrategy: () => null,
    };
  }

  /**
   * Queue a notification job. Worker will process and dispatch to channels.
   * No-op when Redis disabled (jobs are skipped).
   */
  async queue(payload: NotificationJobPayload): Promise<string> {
    const job = await this.notificationQueue.add(
      payload.trigger,
      payload,
      {
        removeOnComplete: { count: 1000 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
    return job.id ?? '';
  }

  /**
   * Queue appointment booked notification.
   */
  async notifyAppointmentBooked(params: {
    businessId: string;
    customerId: string;
    appointmentId: string;
    customerName: string;
    serviceName: string;
    date: string;
    startTime: string;
    phone?: string;
    email?: string;
    pushToken?: string;
  }): Promise<void> {
    const title = 'Appointment confirmed';
    const body = `Hi ${params.customerName}! Your ${params.serviceName} appointment is confirmed for ${params.date} at ${params.startTime}.`;

    const channels: ('SMS' | 'EMAIL' | 'PUSH')[] = [];
    if (params.phone) channels.push('SMS');
    if (params.email) channels.push('EMAIL');
    if (params.pushToken) channels.push('PUSH');

    if (channels.length === 0) return;

    await this.queue({
      trigger: 'appointment_booked',
      businessId: params.businessId,
      customerId: params.customerId,
      channels: ['IN_APP', ...channels],
      title,
      body,
      data: { appointmentId: params.appointmentId },
      phone: params.phone,
      email: params.email,
      pushToken: params.pushToken,
    });
  }

  /**
   * Queue appointment reminder (typically sent 24h or 1h before).
   */
  async notifyAppointmentReminder(params: {
    businessId: string;
    customerId: string;
    appointmentId: string;
    customerName: string;
    serviceName: string;
    date: string;
    startTime: string;
    phone?: string;
    email?: string;
    pushToken?: string;
  }): Promise<void> {
    const title = 'Appointment reminder';
    const body = `Reminder: Your ${params.serviceName} appointment is tomorrow at ${params.startTime}.`;

    const channels: ('SMS' | 'EMAIL' | 'PUSH')[] = [];
    if (params.phone) channels.push('SMS');
    if (params.email) channels.push('EMAIL');
    if (params.pushToken) channels.push('PUSH');

    if (channels.length === 0) return;

    await this.queue({
      trigger: 'appointment_reminder',
      businessId: params.businessId,
      customerId: params.customerId,
      channels: ['IN_APP', ...channels],
      title,
      body,
      data: { appointmentId: params.appointmentId },
      phone: params.phone,
      email: params.email,
      pushToken: params.pushToken,
    });
  }

  /**
   * Queue appointment cancelled notification (in-app for staff).
   */
  async notifyAppointmentCancelled(params: {
    businessId: string;
    customerName: string;
    serviceName: string;
    date: string;
    startTime: string;
  }): Promise<void> {
    const title = 'Appointment cancelled';
    const body = `${params.customerName}'s ${params.serviceName} appointment on ${params.date} at ${params.startTime} was cancelled.`;

    await this.queue({
      trigger: 'appointment_cancelled',
      businessId: params.businessId,
      channels: ['IN_APP'],
      title,
      body,
      data: { date: params.date, startTime: params.startTime },
    });
  }

  /**
   * Queue customer registered notification (in-app for staff).
   */
  async notifyCustomerRegistered(params: {
    businessId: string;
    customerId: string;
    customerName: string;
  }): Promise<void> {
    const title = 'New customer registered';
    const body = `${params.customerName} has been added to your customer list.`;

    await this.queue({
      trigger: 'customer_registered',
      businessId: params.businessId,
      customerId: params.customerId,
      channels: ['IN_APP'],
      title,
      body,
      data: { customerId: params.customerId },
    });
  }

  /**
   * Queue waitlist joined notification (in-app for staff).
   */
  async notifyWaitlistJoined(params: {
    businessId: string;
    customerName: string;
    serviceName: string;
  }): Promise<void> {
    const title = 'Customer joined waitlist';
    const body = `${params.customerName} joined the waitlist for ${params.serviceName}.`;

    await this.queue({
      trigger: 'waitlist_joined',
      businessId: params.businessId,
      channels: ['IN_APP'],
      title,
      body,
      data: {},
    });
  }

  /**
   * Queue waitlist slot available notification.
   */
  async notifyWaitlistSlotAvailable(params: {
    businessId: string;
    customerId: string;
    customerName: string;
    serviceName: string;
    date: string;
    startTime: string;
    reserveMinutes: number;
    phone?: string;
    email?: string;
    pushToken?: string;
  }): Promise<void> {
    const title = 'Slot available!';
    const body = `Hi ${params.customerName}! A slot for ${params.serviceName} is now available on ${params.date} at ${params.startTime}. Book within ${params.reserveMinutes} minutes to secure it.`;

    const channels: ('SMS' | 'EMAIL' | 'PUSH')[] = [];
    if (params.phone) channels.push('SMS');
    if (params.email) channels.push('EMAIL');
    if (params.pushToken) channels.push('PUSH');

    if (channels.length === 0) return;

    await this.queue({
      trigger: 'waitlist_notification',
      businessId: params.businessId,
      customerId: params.customerId,
      channels: ['IN_APP', ...channels],
      title,
      body,
      data: { date: params.date, startTime: params.startTime },
      phone: params.phone,
      email: params.email,
      pushToken: params.pushToken,
    });
  }

  /**
   * Schedule appointment reminder for 24h before.
   * Worker will fetch appointment/customer and send when job runs.
   */
  async scheduleAppointmentReminder(
    appointmentId: string,
    appointmentStartTime: Date,
  ): Promise<void> {
    const remindAt = new Date(appointmentStartTime);
    remindAt.setHours(remindAt.getHours() - 24);
    const delay = remindAt.getTime() - Date.now();
    if (delay <= 0) return;

    await this.notificationQueue.add(
      'appointment_reminder',
      {
        trigger: 'appointment_reminder',
        businessId: '',
        channels: [],
        title: '',
        appointmentId,
        scheduledFor: remindAt.toISOString(),
      } as NotificationJobPayload & { appointmentId: string; scheduledFor: string },
      {
        delay,
        jobId: `reminder:${appointmentId}`,
        removeOnComplete: { count: 100 },
      },
    );
  }
}
