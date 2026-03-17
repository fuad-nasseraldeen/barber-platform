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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { StaffService } from './staff.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateStaffDto } from './dto/create-staff.dto';
import { RegisterStaffDto } from './dto/register-staff.dto';
import { UpdateMyServicesDto } from './dto/update-my-services.dto';
import { UpdateStaffServicesDto } from './dto/update-staff-services.dto';
import { AddStaffServiceDto } from './dto/add-staff-service.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { StaffServicesDto } from './dto/staff-services.dto';
import { StaffWorkingHoursDto } from './dto/staff-working-hours.dto';
import { StaffBreakDto } from './dto/staff-break.dto';
import {
  CreateStaffBreakExceptionDto,
  CreateStaffBreakExceptionBulkDto,
} from './dto/staff-break-exception.dto';
import {
  StaffBreakBulkWeeklyDto,
  StaffBreakBulkWeeklyRangeDto,
} from './dto/staff-break-bulk-weekly.dto';
import { StaffTimeOffDto } from './dto/staff-time-off.dto';
import { DeleteStaffDto } from './dto/delete-staff.dto';
import { ListStaffQueryDto } from './dto/list-staff.dto';
import { UploadPhotoQueryDto } from './dto/upload-photo.dto';
import { RequestVacationDto } from './dto/request-vacation.dto';
import { VacationActionDto } from './dto/vacation-action.dto';
import { RemoveStaffServiceDto } from './dto/remove-staff-service.dto';
import { AddMyServiceDto } from './dto/add-my-service.dto';

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post('register')
  @UseGuards(JwtAuthGuard)
  async register(@CurrentUser('id') userId: string, @Body() dto: RegisterStaffDto) {
    return this.staff.registerFromInvite(userId, dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser('id') userId: string) {
    return this.staff.findMyProfile(userId);
  }

  @Patch('me/services')
  @UseGuards(JwtAuthGuard)
  async updateMyServices(@CurrentUser('id') userId: string, @Body() dto: UpdateMyServicesDto) {
    return this.staff.updateMyServices(userId, dto);
  }

  @Post('me/services')
  @UseGuards(JwtAuthGuard)
  async addMyService(@CurrentUser('id') userId: string, @Body() dto: AddMyServiceDto) {
    return this.staff.addServiceToMyself(userId, dto);
  }

  @Delete('me/services/:staffServiceId')
  @UseGuards(JwtAuthGuard)
  async removeMyService(
    @CurrentUser('id') userId: string,
    @Param('staffServiceId') staffServiceId: string,
  ) {
    return this.staff.removeMyService(userId, staffServiceId);
  }

  @Get('me/breaks')
  @UseGuards(JwtAuthGuard)
  async getMyBreaks(
    @CurrentUser('id') userId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.staff.getMyBreaksByUserId(userId, startDate, endDate);
  }

  @Post('me/breaks')
  @UseGuards(JwtAuthGuard)
  async addMyBreakException(
    @CurrentUser('id') userId: string,
    @Body() dto: Omit<CreateStaffBreakExceptionDto, 'staffId'> & { businessId: string },
  ) {
    return this.staff.addBreakExceptionByUserId(userId, dto);
  }

  @Post('me/breaks/bulk')
  @UseGuards(JwtAuthGuard)
  async addMyBreakExceptionBulk(
    @CurrentUser('id') userId: string,
    @Body() dto: Omit<CreateStaffBreakExceptionBulkDto, 'staffId'> & { businessId: string },
  ) {
    return this.staff.addBreakExceptionBulkByUserId(userId, dto);
  }

  @Delete('me/breaks/exception/:id')
  @UseGuards(JwtAuthGuard)
  async deleteMyBreakException(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.staff.deleteBreakExceptionByUserId(userId, id);
  }

  @Post('me/breaks/weekly')
  @UseGuards(JwtAuthGuard)
  async addMyWeeklyBreak(
    @CurrentUser('id') userId: string,
    @Body() dto: { businessId: string; dayOfWeek: number; startTime: string; endTime: string },
  ) {
    return this.staff.addWeeklyBreakByUserId(userId, dto);
  }

  @Delete('me/breaks/weekly/:id')
  @UseGuards(JwtAuthGuard)
  async deleteMyWeeklyBreak(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.staff.deleteWeeklyBreakByUserId(userId, id);
  }

  @Post('me/time-off')
  @UseGuards(JwtAuthGuard)
  async requestVacation(@CurrentUser('id') userId: string, @Body() dto: RequestVacationDto) {
    return this.staff.requestVacation(userId, dto);
  }

  @Patch('me/time-off/:id/cancel')
  @UseGuards(JwtAuthGuard)
  async cancelOwnVacation(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.staff.cancelOwnVacation(userId, id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMyProfile(@CurrentUser('id') userId: string, @Body() dto: UpdateMyProfileDto) {
    return this.staff.updateMyProfile(userId, dto);
  }

  @Post('me/photo')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: './uploads/staff',
        filename: (_, file, cb) => {
          const ext = extname(file.originalname) || '.jpg';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_, file, cb) => {
        const allowed = /^image\/(jpeg|jpg|png|webp|gif)$/;
        if (allowed.test(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Invalid file type. Use JPEG, PNG, WebP or GIF.'), false);
        }
      },
    }),
  )
  async uploadMyPhoto(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const avatarUrl = `/uploads/staff/${file.filename}`;
    return this.staff.updateMyPhoto(userId, avatarUrl);
  }

  @Get('time-off')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager', 'staff')
  @Permissions('business:read')
  async listTeamVacations(
    @Query('businessId') businessId: string,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.staff.listTeamVacations(businessId, branchId, startDate, endDate);
  }

  @Patch('time-off/:id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async approveVacation(@Param('id') id: string, @Body() dto: VacationActionDto) {
    return this.staff.approveVacation(id, dto.businessId);
  }

  @Patch('time-off/:id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async rejectVacation(@Param('id') id: string, @Body() dto: VacationActionDto) {
    return this.staff.rejectVacation(id, dto.businessId);
  }

  @Delete('time-off/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async deleteVacation(@Param('id') id: string, @Body() dto: VacationActionDto) {
    return this.staff.deleteVacation(id, dto.businessId);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:create')
  async create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto.businessId, dto);
  }

  @Post('services')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async assignServices(@Body() dto: StaffServicesDto) {
    return this.staff.assignServices(dto);
  }

  @Patch(':id/services')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async updateStaffServices(
    @Param('id') staffId: string,
    @Body() dto: UpdateStaffServicesDto,
  ) {
    return this.staff.updateStaffServices(staffId, dto.businessId, dto);
  }

  @Post(':id/services')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async addStaffService(@Param('id') staffId: string, @Body() dto: AddStaffServiceDto) {
    return this.staff.addStaffService(staffId, dto);
  }

  @Delete(':id/services/:staffServiceId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async removeStaffService(
    @Param('id') staffId: string,
    @Param('staffServiceId') staffServiceId: string,
    @Body() dto: RemoveStaffServiceDto,
  ) {
    return this.staff.removeStaffService(staffId, staffServiceId, dto.businessId);
  }

  @Post('working-hours')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async setWorkingHours(@Body() dto: StaffWorkingHoursDto) {
    return this.staff.setWorkingHours(dto);
  }

  @Post('breaks')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async addBreak(@Body() dto: StaffBreakDto) {
    return this.staff.addBreak(dto);
  }

  @Post('breaks/exception')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async addBreakException(@Body() dto: CreateStaffBreakExceptionDto) {
    return this.staff.addBreakException(dto);
  }

  @Post('breaks/bulk-weekly')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async addBreakBulkWeekly(@Body() dto: StaffBreakBulkWeeklyDto) {
    return this.staff.addBreakBulkWeekly(dto);
  }

  @Post('breaks/bulk-weekly-range')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async addBreakExceptionBulkWeeklyRange(@Body() dto: StaffBreakBulkWeeklyRangeDto) {
    return this.staff.addBreakExceptionBulkWeeklyRange(dto);
  }

  @Post('breaks/bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async addBreakExceptionBulk(@Body() dto: CreateStaffBreakExceptionBulkDto) {
    return this.staff.addBreakExceptionBulk(dto);
  }

  @Delete('breaks/weekly/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async deleteWeeklyBreakAdmin(
    @Param('id') id: string,
    @Query('staffId') staffId: string,
    @Query('businessId') businessId: string,
  ) {
    if (!staffId || !businessId) {
      throw new BadRequestException('staffId and businessId are required');
    }
    await this.staff.ensureStaffBelongsToBusiness(staffId, businessId);
    return this.staff.deleteWeeklyBreak(id, staffId);
  }

  @Delete('breaks/exception/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async deleteBreakExceptionAdmin(
    @Param('id') id: string,
    @Query('staffId') staffId: string,
    @Query('businessId') businessId: string,
  ) {
    if (!staffId || !businessId) {
      throw new BadRequestException('staffId and businessId are required');
    }
    await this.staff.ensureStaffBelongsToBusiness(staffId, businessId);
    return this.staff.deleteBreakException(id, staffId);
  }

  @Post('time-off')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:manage')
  async addTimeOff(@Body() dto: StaffTimeOffDto) {
    return this.staff.addTimeOff(dto);
  }

  @Get(':id/breaks')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager', 'staff')
  @Permissions('staff:read')
  async getStaffBreaks(
    @Param('id') staffId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('businessId') businessId: string,
  ) {
    if (!businessId || !startDate || !endDate) {
      throw new BadRequestException('businessId, startDate and endDate are required');
    }
    await this.staff.ensureStaffBelongsToBusiness(staffId, businessId);
    return this.staff.getMyBreaks(staffId, startDate, endDate);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager', 'staff')
  @Permissions('staff:read')
  async findAll(@Query() query: ListStaffQueryDto) {
    return this.staff.findAll(
      query.businessId,
      query.includeInactive === 'true',
      query.branchId,
      query.excludeManagers === 'true',
      query.page,
      query.limit,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager', 'staff')
  @Permissions('staff:read')
  async findById(@Param('id') id: string) {
    return this.staff.findById(id);
  }

  @Post(':id/photo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:update')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: './uploads/staff',
        filename: (_, file, cb) => {
          const ext = extname(file.originalname) || '.jpg';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_, file, cb) => {
        const allowed = /^image\/(jpeg|jpg|png|webp|gif)$/;
        if (allowed.test(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Invalid file type. Use JPEG, PNG, WebP or GIF.'), false);
        }
      },
    }),
  )
  async uploadPhoto(
    @Param('id') id: string,
    @Query() query: UploadPhotoQueryDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const avatarUrl = `/uploads/staff/${file.filename}`;
    return this.staff.updatePhoto(id, query.businessId, avatarUrl);
  }

  @Patch(':id/deactivate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:update')
  async deactivate(
    @Param('id') id: string,
    @Body() dto: DeleteStaffDto,
  ) {
    return this.staff.deactivate(id, dto.businessId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staff.update(id, dto.businessId, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  @Permissions('staff:delete')
  async delete(
    @Param('id') id: string,
    @Body() dto: DeleteStaffDto,
  ) {
    return this.staff.delete(id, dto.businessId);
  }
}
