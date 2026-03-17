import { IsOptional, IsBoolean, IsString, IsEnum, MinLength, MaxLength, Matches, IsObject } from 'class-validator';
import { BusinessTypeEnum } from './create-business.dto';

export class UpdateBusinessDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

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
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  requireEmployeeVacationApproval?: boolean;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
