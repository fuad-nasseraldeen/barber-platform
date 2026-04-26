import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';
export const PERMISSIONS_KEY = 'permissions';

/** Populated from JWT in JwtStrategy — no DB in guard. */
export interface JwtUserContext {
  id: string;
  businessId?: string;
  role?: string;
  permissions?: string[];
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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
    const user = request.user as JwtUserContext | undefined;
    if (!user?.id) {
      throw new ForbiddenException('Unauthorized');
    }

    const jwtBiz = user.businessId;
    const fromRequest =
      request.params?.businessId ??
      request.body?.businessId ??
      request.query?.businessId;

    if (fromRequest && jwtBiz && fromRequest !== jwtBiz) {
      throw new ForbiddenException('Cross-business access denied');
    }

    const permissions = user.permissions ?? [];
    const roleSlug = user.role;

    if (requiredRoles?.length) {
      if (!roleSlug || !requiredRoles.includes(roleSlug)) {
        throw new ForbiddenException(
          `Required role: ${requiredRoles.join(' or ')}`,
        );
      }
    }

    if (requiredPermissions?.length) {
      const hasAny = requiredPermissions.some((p) => permissions.includes(p));
      if (!hasAny) {
        throw new ForbiddenException(
          `Required permission: ${requiredPermissions.join(' or ')}`,
        );
      }
    }

    return true;
  }
}
