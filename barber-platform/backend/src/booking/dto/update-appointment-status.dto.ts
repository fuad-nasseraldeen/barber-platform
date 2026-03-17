import { IsUUID, IsIn } from 'class-validator';

export class UpdateAppointmentStatusDto {
  @IsUUID()
  businessId: string;

  @IsIn(['COMPLETED', 'NO_SHOW'])
  status: 'COMPLETED' | 'NO_SHOW';
}
