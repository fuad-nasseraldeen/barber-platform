import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';

export interface CreateUserInput {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  authProvider?: string;
  authProviderId?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email, deletedAt: null },
    });
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { phone, deletedAt: null },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id, deletedAt: null },
    });
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        authProvider: 'google',
        authProviderId: googleId,
        deletedAt: null,
      },
    });
  }

  async create(data: CreateUserInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        phone: data.phone,
        firstName: data.firstName,
        lastName: data.lastName,
        avatarUrl: data.avatarUrl,
        authProvider: data.authProvider ?? 'phone',
        authProviderId: data.authProviderId,
        emailVerified: data.emailVerified ?? false,
        phoneVerified: data.phoneVerified ?? false,
      },
    });
  }

  async findOrCreateByPhone(
    phone: string,
    opts?: { firstName?: string; lastName?: string },
  ): Promise<User> {
    let user = await this.findByPhone(phone);
    if (!user) {
      user = await this.create({
        phone,
        phoneVerified: true,
        authProvider: 'phone',
        ...opts,
      });
    } else if (!user.phoneVerified) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneVerified: true },
      });
    }
    return user;
  }

  async findOrCreateByGoogle(profile: {
    id: string;
    email?: string;
    givenName?: string;
    familyName?: string;
    picture?: string;
  }): Promise<User> {
    let user = await this.findByGoogleId(profile.id);
    if (user) return user;

    if (profile.email) {
      user = await this.findByEmail(profile.email);
      if (user) {
        return this.linkGoogleAccount(user.id, profile);
      }
    }

    return this.create({
      email: profile.email,
      firstName: profile.givenName,
      lastName: profile.familyName,
      avatarUrl: profile.picture,
      authProvider: 'google',
      authProviderId: profile.id,
      emailVerified: !!profile.email,
    });
  }

  async linkGoogleAccount(
    userId: string,
    profile: { id: string; email?: string; givenName?: string; familyName?: string; picture?: string },
  ): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        authProvider: 'google',
        authProviderId: profile.id,
        email: profile.email ?? undefined,
        firstName: profile.givenName ?? undefined,
        lastName: profile.familyName ?? undefined,
        avatarUrl: profile.picture ?? undefined,
        emailVerified: profile.email ? true : undefined,
      },
    });
    // Sync Google picture to Staff profile (for settings display)
    if (profile.picture) {
      await this.prisma.staff.updateMany({
        where: { userId },
        data: { avatarUrl: profile.picture },
      });
    }
    return user;
  }

  async linkPhoneAccount(userId: string, phone: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { phone, phoneVerified: true },
    });
  }
}
