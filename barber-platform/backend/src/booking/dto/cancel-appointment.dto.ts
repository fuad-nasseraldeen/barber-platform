import { IsUUID, IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelAppointmentDto {
  @IsUUID()
  appointmentId: string;

  @IsUUID()
  businessId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
