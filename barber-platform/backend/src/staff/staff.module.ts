import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { AvailabilityModule } from '../availability/availability.module';

@Module({
  imports: [AvailabilityModule],
  controllers: [StaffController],
  providers: [StaffService, RolesGuard],
  exports: [StaffService],
})
export class StaffModule {}
