import {
  IsString,
  IsOptional,
  IsUUID,
  IsNumber,
  IsBoolean,
  IsArray,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBranchDto {
  @IsUUID()
  businessId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  /** Source branch: copy services and/or move staff from here */
  @IsOptional()
  @IsUUID()
  copyFromBranchId?: string;

  /** Duplicate all services from copyFromBranchId to the new branch */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  copyServices?: boolean;

  /** Move these staff from copyFromBranchId to the new branch */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  moveStaffIds?: string[];
}
