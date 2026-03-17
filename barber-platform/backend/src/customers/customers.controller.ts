import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';
import { ListCustomersQueryDto } from './dto/list-customers.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { DeleteCustomerDto } from './dto/delete-customer.dto';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'manager', 'staff')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  @Permissions('customer:create', 'customer:manage')
  async create(@Body() dto: CreateCustomerDto) {
    return this.customers.create(dto.businessId, dto);
  }

  @Get()
  @Permissions('business:read')
  async findAll(@Query() query: ListCustomersQueryDto) {
    return this.customers.findAll(
      query.businessId,
      query.branchId,
      query.search,
    );
  }

  @Get(':id')
  @Permissions('business:read')
  async findById(@Param('id') id: string, @Query('businessId') businessId: string) {
    return this.customers.findById(id, businessId);
  }

  @Patch(':id')
  @Roles('owner', 'manager')
  @Permissions('customer:update', 'customer:manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(id, dto.businessId, dto);
  }

  @Delete(':id')
  @Roles('owner', 'manager')
  @Permissions('customer:delete', 'customer:manage')
  async delete(
    @Param('id') id: string,
    @Body() dto: DeleteCustomerDto,
  ) {
    return this.customers.delete(id, dto.businessId);
  }
}
