import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

export const ROLES_KEY = 'roles';
export const PERMISSIONS_KEY = 'permissions';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles?.length && !requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.id) {
      throw new ForbiddenException('Unauthorized');
    }

    const businessId =
      request.params?.businessId ||
      request.body?.businessId ||
      request.query?.businessId;
    const businessSlug = request.params?.slug;
    const paramId = request.params?.id;
    const staffId = request.body?.staffId || paramId;

    let business: { id: string } | null = null;
    if (businessId) {
      business = await this.prisma.business.findUnique({
        where: { id: businessId, deletedAt: null },
        select: { id: true },
      });
    }
    if (!business && businessSlug) {
      business = await this.prisma.business.findUnique({
        where: { slug: businessSlug, deletedAt: null },
        select: { id: true },
      });
    }
    if (!business && paramId) {
      business = await this.prisma.business.findUnique({
        where: { id: paramId, deletedAt: null },
        select: { id: true },
      });
    }
    if (!business && staffId) {
      const staff = await this.prisma.staff.findUnique({
        where: { id: staffId, deletedAt: null },
        select: { businessId: true },
      });
      if (staff) {
        business = await this.prisma.business.findUnique({
          where: { id: staff.businessId, deletedAt: null },
          select: { id: true },
        });
      }
    }

    if (!business) {
      throw new ForbiddenException('Business not found');
    }

    const membership = await this.prisma.businessUser.findUnique({
      where: {
        businessId_userId: { businessId: business.id, userId: user.id },
      },
      include: {
        role: {
          include: {
            rolePermissions: { include: { permission: true } },
          },
        },
      },
    });

    if (!membership || !membership.isActive) {
      throw new ForbiddenException('You do not have access to this business');
    }

    if (requiredRoles?.length) {
      const roleSlug = membership.role.slug;
      if (!requiredRoles.includes(roleSlug)) {
        throw new ForbiddenException(
          `Required role: ${requiredRoles.join(' or ')}`,
        );
      }
    }

    if (requiredPermissions?.length) {
      const userPermissions = membership.role.rolePermissions.map(
        (rp) => rp.permission.slug,
      );
      const hasAll = requiredPermissions.every((p) =>
        userPermissions.includes(p),
      );
      if (!hasAll) {
        throw new ForbiddenException(
          `Required permission: ${requiredPermissions.join(', ')}`,
        );
      }
    }

    request.businessMembership = membership;
    request.businessId = business.id;
    return true;
  }
}
