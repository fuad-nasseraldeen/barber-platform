import {
  IsUUID,
  IsOptional,
  IsDateString,
  IsString,
  Matches,
} from 'class-validator';

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
}
