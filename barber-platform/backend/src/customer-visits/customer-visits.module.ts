import { Module } from '@nestjs/common';
import { CustomerVisitsService } from './customer-visits.service';
import { CustomerVisitsController } from './customer-visits.controller';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  controllers: [CustomerVisitsController],
  providers: [CustomerVisitsService, RolesGuard],
  exports: [CustomerVisitsService],
})
export class CustomerVisitsModule {}
