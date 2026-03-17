import {
  IsOptional,
  IsUUID,
  IsDateString,
  IsString,
  Matches,
  MaxLength,
  IsInt,
  Min,
  IsEnum,
} from 'class-validator';
import { WaitlistStatus } from '@prisma/client';

export class UpdateWaitlistDto {
  @IsUUID()
  businessId: string;

  @IsOptional()
  @IsDateString()
  preferredDateStart?: string;

  @IsOptional()
  @IsDateString()
  preferredDateEnd?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  preferredTimeStart?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  preferredTimeEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsEnum(WaitlistStatus)
  status?: WaitlistStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
