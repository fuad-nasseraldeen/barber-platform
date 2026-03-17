import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AutomationService } from './automation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';
import { EvaluateRulesDto } from './dto/evaluate-rules.dto';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';

@Controller('automation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'manager')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get('rules')
  @Permissions('business:read')
  async findAll(@Query('businessId') businessId: string) {
    return this.automation.findAll(businessId);
  }

  @Get('rules/:id')
  @Permissions('business:read')
  async findById(@Param('id') id: string, @Query('businessId') businessId: string) {
    return this.automation.findById(id, businessId);
  }

  @Post('rules')
  @Permissions('business:write', 'business:manage')
  async create(@Body() dto: CreateAutomationDto) {
    return this.automation.create(dto);
  }

  @Put('rules/:id')
  @Permissions('business:write', 'business:manage')
  async update(
    @Param('id') id: string,
    @Query('businessId') businessId: string,
    @Body() dto: UpdateAutomationDto,
  ) {
    return this.automation.update(id, businessId, dto);
  }

  @Delete('rules/:id')
  @Permissions('business:write', 'business:manage')
  async delete(@Param('id') id: string, @Query('businessId') businessId: string) {
    return this.automation.delete(id, businessId);
  }

  @Post('evaluate-visit-rules')
  @Permissions('business:read')
  async evaluateVisitRules(@Body() dto: EvaluateRulesDto) {
    return this.automation.evaluateVisitRules(
      dto.customerId,
      dto.businessId,
      dto.conditions,
    );
  }
}
