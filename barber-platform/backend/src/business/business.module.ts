import { Module } from '@nestjs/common';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { OtpModule } from '../otp/otp.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [OtpModule, StaffModule],
  controllers: [BusinessController],
  providers: [BusinessService, RolesGuard],
  exports: [BusinessService],
})
export class BusinessModule {}
