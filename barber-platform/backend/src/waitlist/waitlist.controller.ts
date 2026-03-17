import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WaitlistService } from './waitlist.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';
import { CreateWaitlistDto } from './dto/create-waitlist.dto';
import { UpdateWaitlistDto } from './dto/update-waitlist.dto';
import { CancelWaitlistDto } from './dto/cancel-waitlist.dto';

@Controller('waitlist')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'manager', 'staff', 'customer')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Post()
  @Permissions('waitlist:create')
  async create(@Body() dto: CreateWaitlistDto) {
    return this.waitlist.create(dto);
  }

  @Get()
  @Permissions('waitlist:read')
  async findAll(
    @Query('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.waitlist.findAll(
      businessId,
      status,
      branchId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Get(':id')
  @Permissions('waitlist:read')
  async findById(@Param('id') id: string) {
    return this.waitlist.findById(id);
  }

  @Patch(':id')
  @Permissions('waitlist:update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWaitlistDto,
  ) {
    return this.waitlist.update(id, dto.businessId, dto);
  }

  @Post(':id/cancel')
  @Permissions('waitlist:update')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelWaitlistDto,
  ) {
    return this.waitlist.cancel(id, dto.businessId);
  }
}
