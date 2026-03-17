import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'manager', 'staff')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Permissions('business:read')
  async findAll(
    @Query('businessId') businessId: string,
    @Query('limit') limit = '20',
    @Query('page') page = '1',
    @Query('userId') userId?: string,
  ) {
    const take = Math.min(parseInt(limit, 10) || 20, 100);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (pageNum - 1) * take;
    const where: { businessId: string; userId?: string } = { businessId };
    if (userId) where.userId = userId;

    const notifications = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        data: true,
        channel: true,
        readAt: true,
        createdAt: true,
      },
    });

    return notifications;
  }
}
