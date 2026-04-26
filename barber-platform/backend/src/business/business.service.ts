import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService, CACHE_TTL } from '../redis/cache.service';
import { BusinessType } from '@prisma/client';
import * as crypto from 'crypto';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { InviteStaffByPhoneDto } from './dto/invite-staff-by-phone.dto';
import { OtpService } from '../otp/otp.service';
import { normalizePhone } from '../common/validators/phone.validator';
import { StaffService } from '../staff/staff.service';

const INVITE_EXPIRY_DAYS = 7;

@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly otp: OtpService,
    private readonly staffService: StaffService,
  ) {}

  async create(userId: string, dto: CreateBusinessDto) {
    if (dto.ownerPhone && dto.ownerPhoneCode) {
      const valid = await this.otp.verifyOtp(dto.ownerPhone, dto.ownerPhoneCode);
      if (!valid) {
        throw new BadRequestException('Invalid phone verification code');
      }
    }

    const slug = dto.slug ?? this.generateSlug(dto.name);
    const existing = await this.prisma.business.findUnique({
      where: { slug, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('Business slug already exists');
    }

    const ownerRole = await this.getOrCreateSystemRole('owner');
    const business = await this.prisma.business.create({
      data: {
        name: dto.name,
        slug,
        type: (dto.type as BusinessType) ?? 'BARBER_SHOP',
        timezone: dto.timezone ?? 'Asia/Jerusalem',
        locale: dto.locale ?? 'he',
        currency: dto.currency ?? 'USD',
      },
    });

    await this.prisma.businessUser.create({
      data: {
        businessId: business.id,
        userId,
        roleId: ownerRole.id,
      },
    });

    const mainBranch = await this.prisma.branch.create({
      data: {
        businessId: business.id,
        name: 'Main Branch',
        address: dto.address ?? null,
        street: dto.street ?? null,
        city: dto.city ?? null,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        phone: dto.phone ?? null,
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, phone: true, avatarUrl: true },
    });
    const ownerFirstName = dto.owner?.firstName ?? user?.firstName ?? 'Owner';
    const ownerLastName = dto.owner?.lastName ?? user?.lastName ?? '';
    const ownerPhone = dto.ownerPhone
      ? normalizePhone(dto.ownerPhone.replace(/\s/g, ''))
      : user?.phone ?? null;
    const ownerStaff = await this.prisma.staff.create({
      data: {
        businessId: business.id,
        branchId: mainBranch.id,
        userId,
        firstName: ownerFirstName,
        lastName: ownerLastName || ' ',
        phone: ownerPhone,
        avatarUrl: user?.avatarUrl ?? undefined,
      },
    });
    await this.staffService.applyDefaultWorkingScheduleForNewStaff(ownerStaff.id, ownerStaff.branchId);

    if (dto.owner) {
      const updateData: { firstName?: string; lastName?: string; birthDate?: Date; gender?: string; phone?: string; phoneVerified?: boolean } = {};
      if (dto.owner.firstName) updateData.firstName = dto.owner.firstName;
      if (dto.owner.lastName) updateData.lastName = dto.owner.lastName;
      if (dto.owner.birthDate) updateData.birthDate = new Date(dto.owner.birthDate);
      if (dto.owner.gender) updateData.gender = dto.owner.gender;

      if (dto.ownerPhone && dto.ownerPhoneCode) {
        const existingUserWithPhone = await this.prisma.user.findUnique({
          where: { phone: dto.ownerPhone },
        });
        if (existingUserWithPhone && existingUserWithPhone.id !== userId) {
          throw new ConflictException('Phone number already in use by another account');
        }
        updateData.phone = dto.ownerPhone;
        updateData.phoneVerified = true;
      }

      if (Object.keys(updateData).length > 0) {
        await this.prisma.user.update({
          where: { id: userId },
          data: updateData,
        });
      }
    }

    return this.findById(business.id);
  }

  private generateSlug(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${base || 'business'}-${suffix}`;
  }

  async findBySlug(slug: string, viewerBusinessId?: string) {
    const cacheKey = CacheService.keys.business(slug);
    const cached = await this.cache.get<Awaited<ReturnType<typeof this.fetchBusinessBySlug>>>(cacheKey);
    const business = cached ?? (await this.fetchBusinessBySlug(slug));
    if (viewerBusinessId && business.id !== viewerBusinessId) {
      throw new ForbiddenException('Business does not match your session');
    }
    if (!cached) {
      await this.cache.set(cacheKey, business, CACHE_TTL.BUSINESS);
    }
    return business;
  }

  async findById(id: string) {
    const cacheKey = CacheService.keys.businessById(id);
    const cached = await this.cache.get<Awaited<ReturnType<typeof this.fetchBusinessById>>>(cacheKey);
    if (cached) return cached;
    const business = await this.fetchBusinessById(id);
    await this.cache.set(cacheKey, business, CACHE_TTL.BUSINESS);
    return business;
  }

  private async fetchBusinessBySlug(slug: string) {
    const business = await this.prisma.business.findUnique({
      where: { slug, deletedAt: null },
      include: {
        locations: { where: { deletedAt: null } },
        branches: true,
      },
    });
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    return business;
  }

  private async fetchBusinessById(id: string) {
    const business = await this.prisma.business.findUnique({
      where: { id, deletedAt: null },
      include: {
        locations: { where: { deletedAt: null } },
        branches: true,
      },
    });
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    return business;
  }

  async update(id: string, dto: UpdateBusinessDto) {
    const business = await this.fetchBusinessById(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.type !== undefined) data.type = dto.type as BusinessType;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.locale !== undefined) data.locale = dto.locale;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.requireEmployeeVacationApproval !== undefined) data.requireEmployeeVacationApproval = dto.requireEmployeeVacationApproval;
    if (dto.settings !== undefined) {
      const current = (business as { settings?: object }).settings ?? {};
      data.settings = { ...(typeof current === 'object' && current !== null ? current : {}), ...dto.settings };
    }
    const updated = await this.prisma.business.update({
      where: { id },
      data: data as Parameters<typeof this.prisma.business.update>[0]['data'],
    });
    await this.cache.invalidateBusiness(id);
    await this.cache.invalidateBusinessBySlug(business.slug);
    if (dto.slug && dto.slug !== business.slug) {
      await this.cache.invalidateBusinessBySlug(dto.slug);
    }
    return updated;
  }

  async delete(id: string) {
    const business = await this.fetchBusinessById(id);
    await this.prisma.business.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.cache.invalidateBusiness(id);
    await this.cache.invalidateBusinessBySlug(business.slug);
    return { success: true };
  }

  async invite(businessId: string, inviterId: string, dto: InviteStaffDto) {
    const role = await this.getOrCreateBusinessRole(businessId, dto.role);

    const existingInvite = await this.prisma.businessInvite.findUnique({
      where: { businessId_email: { businessId, email: dto.email } },
    });
    if (existingInvite && !existingInvite.acceptedAt && existingInvite.expiresAt > new Date()) {
      throw new ConflictException('Invite already sent to this email');
    }

    const existingMember = await this.prisma.businessUser.findFirst({
      where: {
        businessId,
        user: { email: dto.email },
      },
    });
    if (existingMember) {
      throw new ConflictException('User is already a member');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

    await this.prisma.businessInvite.upsert({
      where: { businessId_email: { businessId, email: dto.email } },
      create: {
        businessId,
        email: dto.email,
        roleId: role.id,
        token,
        expiresAt,
      },
      update: {
        roleId: role.id,
        token,
        expiresAt,
        acceptedAt: null,
      },
    });

    return {
      success: true,
      inviteLink: `${process.env.APP_URL || 'http://localhost:3000'}/join?token=${token}`,
      expiresAt,
    };
  }

  async inviteStaffByPhone(businessId: string, inviterId: string, dto: InviteStaffByPhoneDto) {
    const role = await this.getOrCreateSystemRole('staff');
    // Normalize to E164 so it matches user.phone after OTP login (verify-otp uses normalizePhone)
    const normalizedPhone = normalizePhone(dto.phone.replace(/\s/g, ''));

    const existingInvite = await this.prisma.staffInvite.findUnique({
      where: { businessId_phone: { businessId, phone: normalizedPhone } },
    });
    if (existingInvite && existingInvite.status === 'PENDING' && existingInvite.expiresAt > new Date()) {
      throw new ConflictException('Invite already sent to this phone number');
    }

    const existingStaff = await this.prisma.staff.findFirst({
      where: {
        businessId,
        phone: normalizedPhone,
        deletedAt: null,
      },
    });
    if (existingStaff) {
      throw new ConflictException('This phone is already a staff member');
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

    await this.prisma.staffInvite.upsert({
      where: { businessId_phone: { businessId, phone: normalizedPhone } },
      create: {
        businessId,
        branchId: dto.branchId ?? null,
        phone: normalizedPhone,
        roleId: role.id,
        expiresAt,
      },
      update: {
        branchId: dto.branchId ?? null,
        roleId: role.id,
        expiresAt,
        status: 'PENDING',
        acceptedAt: null,
        staffId: null,
      },
    });

    return {
      success: true,
      message: 'Staff invite sent. When they log in with this phone, they will complete registration.',
      expiresAt,
    };
  }

  async listPendingStaffInvites(businessId: string) {
    const now = new Date();
    return this.prisma.staffInvite.findMany({
      where: {
        businessId,
        status: 'PENDING',
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phone: true,
        createdAt: true,
        expiresAt: true,
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async join(userId: string, token: string) {
    const invite = await this.prisma.businessInvite.findUnique({
      where: { token },
      include: { business: true, role: true },
    });

    if (!invite) {
      throw new BadRequestException('Invalid invite token');
    }
    if (invite.acceptedAt) {
      throw new BadRequestException('Invite already accepted');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Invite has expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    const inviteEmail = invite.email.toLowerCase();
    const userEmail = user.email?.toLowerCase();
    if (userEmail && userEmail !== inviteEmail) {
      throw new BadRequestException('Invite was sent to a different email');
    }
    if (!userEmail) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { email: invite.email, emailVerified: true },
      });
    }

    const existingMember = await this.prisma.businessUser.findUnique({
      where: {
        businessId_userId: { businessId: invite.businessId, userId },
      },
    });
    if (existingMember) {
      throw new ConflictException('You are already a member');
    }

    await this.prisma.$transaction([
      this.prisma.businessUser.create({
        data: {
          businessId: invite.businessId,
          userId,
          roleId: invite.roleId,
          invitedAt: new Date(),
        },
      }),
      this.prisma.businessInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    return this.findById(invite.businessId);
  }

  private async getOrCreateSystemRole(slug: string) {
    let role = await this.prisma.role.findFirst({
      where: { slug, businessId: null, isSystem: true },
    });
    if (!role) {
      role = await this.prisma.role.create({
        data: {
          name: slug.charAt(0).toUpperCase() + slug.slice(1),
          slug,
          businessId: null,
          isSystem: true,
        },
      });
    }
    return role;
  }

  private async getOrCreateBusinessRole(businessId: string, slug: string) {
    return this.getOrCreateSystemRole(slug);
  }
}
