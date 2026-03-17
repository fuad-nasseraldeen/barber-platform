import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'manager', 'staff')
@Permissions('analytics:read')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  async getAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.analytics.getAnalytics(
      query.businessId,
      query.startDate,
      query.endDate,
      query.branchId,
      query.staffId,
    );
  }

  @Get('dashboard')
  async getDashboard(@Query() query: DashboardQueryDto) {
    return this.analytics.getDashboard(query.businessId, query.branchId);
  }
}
