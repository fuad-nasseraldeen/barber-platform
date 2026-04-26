import {
  IsString,
  IsOptional,
  IsEmail,
  IsUUID,
  IsBoolean,
  IsNumber,
  Min,
  MinLength,
  MaxLength,
  IsDateString,
  IsIn,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateStaffDto {
  @IsUUID()
  businessId: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  instagram?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  facebook?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  whatsapp?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyTargetRevenue?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsDateString()
  birthDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: string | null;
}
