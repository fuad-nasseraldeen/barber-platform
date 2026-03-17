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
import { BranchesService } from './branches.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { DeleteBranchDto } from './dto/delete-branch.dto';
import { ListBranchesQueryDto } from './dto/list-branches.dto';

@Controller('branches')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'manager', 'staff')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @Permissions('business:read')
  async findAll(@Query() query: ListBranchesQueryDto) {
    return this.branches.findAll(query.businessId);
  }

  @Post()
  @Roles('owner', 'manager')
  @Permissions('location:create')
  async create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto.businessId, dto);
  }

  @Patch(':id')
  @Roles('owner', 'manager')
  @Permissions('location:update')
  async update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(id, dto.businessId, dto);
  }

  @Delete(':id')
  @Roles('owner', 'manager')
  @Permissions('location:delete')
  async delete(@Param('id') id: string, @Body() dto: DeleteBranchDto) {
    return this.branches.delete(id, dto.businessId);
  }
}
