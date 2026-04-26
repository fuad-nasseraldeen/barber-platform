import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

/** HttpOnly cookie name for opaque refresh token (DB-backed, rotated on each refresh). */
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

@Injectable()
export class AuthCookieService {
  constructor(private readonly config: ConfigService) {}

  private refreshMaxAgeMs(): number {
    const raw = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '90d');
    const match = raw.match(/^(\d+)([smhd])$/);
    if (!match) return 90 * 86400 * 1000;
    const n = parseInt(match[1], 10);
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return n * (multipliers[match[2]] ?? 86_400_000);
  }

  private isSecureCookie(): boolean {
    const explicit = this.config.get<string>('REFRESH_COOKIE_SECURE', '').toLowerCase();
    if (explicit === 'true') return true;
    if (explicit === 'false') return false;
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private sameSite(): 'strict' | 'lax' | 'none' {
    const raw = (this.config.get<string>('REFRESH_COOKIE_SAME_SITE', 'strict') || 'strict').trim().toLowerCase();
    if (raw === 'lax' || raw === 'none' || raw === 'strict') return raw;
    return 'strict';
  }

  /** Attach rotated refresh token (caller must not send it in JSON to browsers). */
  setRefreshToken(res: Response, token: string): void {
    const secure = this.isSecureCookie();
    const sameSite = this.sameSite();
    res.cookie(REFRESH_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite,
      path: '/',
      maxAge: this.refreshMaxAgeMs(),
    });
  }

  clearRefreshToken(res: Response): void {
    const secure = this.isSecureCookie();
    const sameSite = this.sameSite();
    res.clearCookie(REFRESH_TOKEN_COOKIE, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite,
    });
  }
}
