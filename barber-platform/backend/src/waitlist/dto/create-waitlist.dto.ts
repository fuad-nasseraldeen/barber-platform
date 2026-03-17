import {
  IsUUID,
  IsOptional,
  IsDateString,
  IsString,
  Matches,
  MaxLength,
  IsInt,
  Min,
} from 'class-validator';

export class CreateWaitlistDto {
  @IsUUID()
  businessId: string;

  @IsUUID()
  customerId: string;

  @IsUUID()
  serviceId: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsDateString()
  preferredDateStart?: string;

  @IsOptional()
  @IsDateString()
  preferredDateEnd?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'preferredTimeStart must be HH:mm format',
  })
  preferredTimeStart?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'preferredTimeEnd must be HH:mm format',
  })
  preferredTimeEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
