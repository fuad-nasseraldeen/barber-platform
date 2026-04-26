import { forwardRef, Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { AutomationWorkerService } from './automation-worker.service';
import { AutomationSchedulerService } from './automation-scheduler.service';
import { CustomerVisitsModule } from '../customer-visits/customer-visits.module';
import { QueuesModule } from '../queues/queues.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SmsModule } from '../sms/sms.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { AvailabilityModule } from '../availability/availability.module';

@Module({
  imports: [
    CustomerVisitsModule,
    forwardRef(() => QueuesModule),
    NotificationsModule,
    SmsModule,
    AvailabilityModule,
  ],
  controllers: [AutomationController],
  providers: [
    AutomationService,
    AutomationWorkerService,
    AutomationSchedulerService,
    RolesGuard,
  ],
  exports: [AutomationService],
})
export class AutomationModule {}
