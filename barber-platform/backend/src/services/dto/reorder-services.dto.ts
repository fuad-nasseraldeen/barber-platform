import { IsUUID, IsArray, ArrayMinSize } from 'class-validator';

export class ReorderServicesDto {
  @IsUUID()
  businessId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  serviceIds: string[];
}
