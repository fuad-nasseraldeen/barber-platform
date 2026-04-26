import { IsUUID, IsOptional, IsDateString } from 'class-validator';

/** For drag & drop / resize - update appointment time and/or staff */
export class UpdateAppointmentDto {
  @IsUUID()
  businessId: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;
}
