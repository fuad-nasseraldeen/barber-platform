import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsEnum, MinLength, MaxLength, Matches, IsNumber } from 'class-validator';
import { normalizePhone } from '../../common/validators/phone.validator';

export enum BusinessTypeEnum {
  BARBER_SHOP = 'BARBER_SHOP',
  BEAUTY_SALON = 'BEAUTY_SALON',
  GYM = 'GYM',
  CLINIC = 'CLINIC',
}

export class CreateBusinessDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must be lowercase alphanumeric with hyphens' })
  slug?: string;

  @IsOptional()
  @IsEnum(BusinessTypeEnum)
  type?: BusinessTypeEnum;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  @IsNumber()
  lat?: number;

  @IsOptional()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  @IsNumber()
  lng?: number;

  @IsOptional()
  owner?: {
    firstName?: string;
    lastName?: string;
    birthDate?: string;
    gender?: string;
  };

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? normalizePhone(value) : value))
  @IsString()
  ownerPhone?: string;

  @IsOptional()
  @IsString()
  ownerPhoneCode?: string;
}
