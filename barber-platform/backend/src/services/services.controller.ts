import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { DeleteServiceDto } from './dto/delete-service.dto';
import { ReorderServicesDto } from './dto/reorder-services.dto';
import { AssignStaffToServiceDto } from './dto/assign-staff.dto';
import { ListServicesQueryDto } from './dto/list-services.dto';
import { DuplicateServiceDto } from './dto/duplicate-service.dto';

@Controller('services')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'manager', 'staff')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @Permissions('service:read', 'business:read')
  async findAll(@Query() query: ListServicesQueryDto) {
    return this.services.findAll(
      query.businessId,
      query.categoryId,
      query.includeInactive === 'true',
      query.branchId,
    );
  }

  @Get(':id')
  @Permissions('service:read', 'business:read')
  async findById(@Param('id') id: string) {
    return this.services.findById(id);
  }

  @Post(':id/duplicate')
  @Roles('owner', 'manager')
  @Permissions('service:create', 'service:manage')
  async duplicate(
    @Param('id') id: string,
    @Body() dto: DuplicateServiceDto,
  ) {
    return this.services.duplicateToBranch(id, dto.businessId, dto.targetBranchId);
  }

  @Post('reorder')
  @Roles('owner', 'manager')
  @Permissions('service:update', 'service:manage')
  async reorder(@Body() dto: ReorderServicesDto) {
    return this.services.reorder(dto.businessId, dto.serviceIds);
  }

  @Post()
  @Roles('owner', 'manager')
  @Permissions('service:create', 'service:manage')
  async create(@Body() dto: CreateServiceDto) {
    return this.services.create(dto.businessId, dto);
  }

  @Patch(':id')
  @Roles('owner', 'manager')
  @Permissions('service:update', 'service:manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.services.update(id, dto.businessId, dto);
  }

  @Patch(':id/staff')
  @Roles('owner', 'manager')
  @Permissions('service:update', 'service:manage')
  async assignStaff(
    @Param('id') id: string,
    @Body() dto: AssignStaffToServiceDto,
  ) {
    return this.services.assignStaff(id, dto.businessId, dto);
  }

  @Delete(':id')
  @Roles('owner', 'manager')
  @Permissions('service:delete', 'service:manage')
  async delete(
    @Param('id') id: string,
    @Body() dto: DeleteServiceDto,
  ) {
    return this.services.delete(id, dto.businessId);
  }
}
