import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { SmsService } from '../sms/sms.service';
import { User } from '@prisma/client';
import * as crypto from 'crypto';

export interface TokenPayload {
  sub: string;
  email?: string;
  phone?: string;
  type: 'access' | 'refresh';
}

export type RedirectTo = 'admin' | 'staff' | 'register-shop' | 'register-staff';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: Omit<User, 'passwordHash'> & { businessId?: string; role?: string; name?: string; staffId?: string };
  redirectTo: RedirectTo;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly otp: OtpService,
    private readonly sms: SmsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async demoLogin(): Promise<AuthTokens> {
    if (this.config.get('NODE_ENV') !== 'development') {
      throw new UnauthorizedException('Demo login only available in development');
    }
    const user = await this.prisma.user.findFirst({
      where: { email: 'owner@demo.com', deletedAt: null },
    });
    if (!user) {
      throw new NotFoundException('Demo user not found. Run: npm run prisma:seed');
    }
    return this.generateTokens(user);
  }

  async requestOtp(phone: string, senderId?: string): Promise<{ success: boolean }> {
    const code = await this.otp.createAndStoreOtp(phone);
    console.log(`[OTP] ${phone} → ${code}`);
    await this.sms.sendOtp(phone, code, senderId);
    return { success: true };
  }

  async verifyOtp(
    phone: string,
    code: string,
    opts?: { firstName?: string; lastName?: string },
  ): Promise<AuthTokens> {
    const valid = await this.otp.verifyOtp(phone, code);
    if (!valid) {
      throw new BadRequestException('Invalid OTP');
    }

    const user = await this.users.findOrCreateByPhone(phone, opts);
    return this.generateTokens(user);
  }

  async googleAuth(profile: {
    id: string;
    email?: string;
    givenName?: string;
    familyName?: string;
    picture?: string;
  }): Promise<AuthTokens> {
    const user = await this.users.findOrCreateByGoogle(profile);
    return this.generateTokens(user);
  }

  async linkGoogle(
    userId: string,
    profile: { id: string; email?: string; givenName?: string; familyName?: string; picture?: string },
  ): Promise<AuthTokens> {
    const user = await this.users.linkGoogleAccount(userId, profile);
    return this.generateTokens(user);
  }

  async linkPhone(userId: string, phone: string, code: string): Promise<AuthTokens> {
    const valid = await this.otp.verifyOtp(phone, code);
    if (!valid) {
      throw new BadRequestException('Invalid OTP');
    }
    const user = await this.users.linkPhoneAccount(userId, phone);
    return this.generateTokens(user);
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.generateTokens(stored.user);
  }

  async logout(refreshToken?: string): Promise<{ success: boolean }> {
    if (refreshToken) {
      const stored = await this.prisma.refreshToken.findUnique({
        where: { token: refreshToken },
      });
      if (stored && !stored.revokedAt && stored.expiresAt >= new Date()) {
        await this.prisma.refreshToken.update({
          where: { id: stored.id },
          data: { revokedAt: new Date() },
        });
      }
    }
    return { success: true };
  }

  private async generateTokens(user: User): Promise<AuthTokens> {
    const payload: TokenPayload = {
      sub: user.id,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      type: 'access',
    };

    const expiresIn = this.config.get('JWT_EXPIRES_IN', '15m');
    const expiresInSeconds = this.parseExpiry(expiresIn);

    const accessToken = this.jwt.sign(payload, {
      expiresIn,
      secret: this.config.get('JWT_SECRET'),
    });

    const refreshToken = crypto.randomBytes(32).toString('hex');
    const refreshExpires = this.config.get('JWT_REFRESH_EXPIRES_IN', '90d');
    const refreshExpiresSeconds = this.parseExpiry(refreshExpires);
    const refreshExpiresDate = new Date();
    refreshExpiresDate.setTime(refreshExpiresDate.getTime() + refreshExpiresSeconds * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: refreshExpiresDate,
      },
    });

    const { passwordHash: _, ...userWithoutPassword } = user;
    const { enriched, redirectTo } = await this.enrichUserWithBusiness(userWithoutPassword);
    return {
      accessToken,
      refreshToken,
      expiresIn: expiresInSeconds,
      user: enriched,
      redirectTo,
    };
  }

  private async enrichUserWithBusiness(
    user: Omit<User, 'passwordHash'>,
  ): Promise<{
    enriched: Omit<User, 'passwordHash'> & { businessId?: string; role?: string; name?: string; staffId?: string };
    redirectTo: RedirectTo;
  }> {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || user.phone || undefined;
    const base = { ...user, name };

    // 1. Admin/Manager: has BusinessUser with owner or manager role
    const bu = await this.prisma.businessUser.findFirst({
      where: { userId: user.id, isActive: true },
      include: { role: true },
    });
    if (bu && ['owner', 'manager'].includes(bu.role.slug)) {
      const ownerStaff = await this.prisma.staff.findFirst({
        where: { userId: user.id, businessId: bu.businessId, deletedAt: null },
      });
      return {
        enriched: {
          ...base,
          businessId: bu.businessId,
          role: bu.role.slug,
          staffId: ownerStaff?.id,
        },
        redirectTo: 'admin',
      };
    }

    // 2. Staff: has Staff record linked to user
    const staff = await this.prisma.staff.findFirst({
      where: { userId: user.id, deletedAt: null },
    });
    if (staff) {
      return {
        enriched: { ...base, businessId: staff.businessId, role: 'staff', staffId: staff.id },
        redirectTo: 'staff',
      };
    }

    // 3. Invited staff: has pending StaffInvite by phone, needs to complete registration
    if (user.phone) {
      const staffInvite = await this.prisma.staffInvite.findFirst({
        where: {
          phone: user.phone,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        include: { business: true },
      });
      if (staffInvite) {
        return {
          enriched: { ...base, businessId: staffInvite.businessId },
          redirectTo: 'register-staff',
        };
      }
    }

    // 4. New user: redirect to shop registration
    if (bu) {
      return { enriched: { ...base, businessId: bu.businessId, role: bu.role.slug }, redirectTo: 'register-shop' };
    }
    return { enriched: base, redirectTo: 'register-shop' };
  }

  private parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 900;
    const [, num, unit] = match;
    const n = parseInt(num, 10);
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return n * (multipliers[unit] ?? 60);
  }
}
