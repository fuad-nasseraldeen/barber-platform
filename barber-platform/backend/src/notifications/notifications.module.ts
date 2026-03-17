import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationService } from './notification.service';
import { NotificationWorkerService } from './notification-worker.service';
import { ArrivalConfirmationService } from './arrival-confirmation.service';
import { EmailService } from './email.service';
import { PushService } from './push.service';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [SmsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsGateway,
    NotificationService,
    NotificationWorkerService,
    ArrivalConfirmationService,
    EmailService,
    PushService,
  ],
  exports: [NotificationService, NotificationsGateway, EmailService, ArrivalConfirmationService],
})
export class NotificationsModule {}
