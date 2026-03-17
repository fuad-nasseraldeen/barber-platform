import {
  IsUUID,
  IsDateString,
  IsString,
  Matches,
  IsOptional,
  MaxLength,
} from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID()
  businessId: string;

  @IsUUID()
  staffId: string;

  @IsUUID()
  serviceId: string;

  @IsUUID()
  customerId: string;

  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime must be HH:mm format (24h)',
  })
  startTime: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}
