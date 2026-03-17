import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsAggregationService, RolesGuard],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
