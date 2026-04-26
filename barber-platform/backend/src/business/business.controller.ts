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
  ForbiddenException,
} from '@nestjs/common';
import { BusinessService } from './business.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { InviteStaffByPhoneDto } from './dto/invite-staff-by-phone.dto';
import { JoinBusinessDto } from './dto/join-business.dto';

@Controller('business')
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Post('create')
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateBusinessDto,
  ) {
    return this.business.create(userId, dto);
  }

  @Post('join')
  @UseGuards(JwtAuthGuard)
  async join(
    @CurrentUser('id') userId: string,
    @Body() dto: JoinBusinessDto,
  ) {
    return this.business.join(userId, dto.token);
  }

  @Get('by-id/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions('business:read')
  async getById(
    @Param('id') id: string,
    @CurrentUser('businessId') viewerBusinessId: string | undefined,
  ) {
    if (viewerBusinessId && id !== viewerBusinessId) {
      throw new ForbiddenException('Cross-business access denied');
    }
    return this.business.findById(id);
  }

  @Get('staff-invites')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:read')
  async listStaffInvites(@Query('businessId') businessId: string) {
    return this.business.listPendingStaffInvites(businessId);
  }

  @Get(':slug')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Permissions('business:read')
  async getBySlug(
    @Param('slug') slug: string,
    @CurrentUser('businessId') viewerBusinessId: string | undefined,
  ) {
    return this.business.findBySlug(slug, viewerBusinessId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBusinessDto,
    @CurrentUser('businessId') viewerBusinessId: string | undefined,
  ) {
    if (viewerBusinessId && id !== viewerBusinessId) {
      throw new ForbiddenException('Cross-business access denied');
    }
    return this.business.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner')
  async delete(
    @Param('id') id: string,
    @CurrentUser('businessId') viewerBusinessId: string | undefined,
  ) {
    if (viewerBusinessId && id !== viewerBusinessId) {
      throw new ForbiddenException('Cross-business access denied');
    }
    return this.business.delete(id);
  }

  @Post('invite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  async invite(
    @CurrentUser('id') userId: string,
    @Body() dto: InviteStaffDto,
  ) {
    return this.business.invite(dto.businessId, userId, dto);
  }

  @Post('invite-staff-by-phone')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  async inviteStaffByPhone(
    @CurrentUser('id') userId: string,
    @Body() dto: InviteStaffByPhoneDto,
  ) {
    return this.business.inviteStaffByPhone(dto.businessId, userId, dto);
  }
}
