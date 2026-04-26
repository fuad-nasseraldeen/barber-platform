import {
  IsUUID,
  IsOptional,
  IsDateString,
  IsString,
  Matches,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ConvertWaitlistDto {
  @IsUUID()
  waitlistId: string;

  @IsUUID()
  businessId: string;

  @IsUUID()
  customerId: string;

  @IsUUID()
  staffId: string;

  @IsUUID()
  serviceId: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  startTime: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  durationMinutes: number;
}
