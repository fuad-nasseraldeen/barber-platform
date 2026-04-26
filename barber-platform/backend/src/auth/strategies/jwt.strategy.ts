import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email?: string;
  phone?: string;
  type: string;
  /** Set on access tokens at login (see auth.service TokenPayload). */
  businessId?: string;
  role?: string;
  /** Permission slugs embedded at token issue time — RolesGuard reads these (no DB). */
  permissions?: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }
    return {
      id: payload.sub,
      email: payload.email,
      phone: payload.phone,
      businessId: payload.businessId,
      role: payload.role,
      permissions: payload.permissions ?? [],
    };
  }
}
