import { IsUUID, IsArray, ArrayMinSize } from 'class-validator';

export class StaffServicesDto {
  @IsUUID()
  staffId: string;

  @IsUUID()
  businessId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  serviceIds: string[];
}
