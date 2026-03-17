import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { CustomerVisitsService } from './customer-visits.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';

@Controller('customer-visits')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'manager', 'staff')
export class CustomerVisitsController {
  constructor(private readonly visits: CustomerVisitsService) {}

  @Get('customer/:customerId')
  @Permissions('business:read')
  async getByCustomer(
    @Param('customerId') customerId: string,
    @Query('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.visits.findByCustomer(
      customerId,
      businessId,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get('customer/:customerId/stats')
  @Permissions('business:read')
  async getCustomerStats(
    @Param('customerId') customerId: string,
    @Query('businessId') businessId: string,
  ) {
    return this.visits.getCustomerVisitStats(customerId, businessId);
  }
}
