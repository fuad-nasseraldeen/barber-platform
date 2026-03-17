import { IsUUID } from 'class-validator';

export class RemoveStaffServiceDto {
  @IsUUID()
  businessId: string;
}
