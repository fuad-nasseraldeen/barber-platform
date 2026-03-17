import { IsUUID } from 'class-validator';

export class DeleteStaffDto {
  @IsUUID()
  businessId: string;
}
