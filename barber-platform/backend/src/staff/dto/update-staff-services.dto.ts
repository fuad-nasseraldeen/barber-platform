import { IsUUID, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateMyServiceItemDto } from './update-my-services.dto';

export class UpdateStaffServicesDto {
  @IsUUID()
  businessId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateMyServiceItemDto)
  updates: UpdateMyServiceItemDto[];
}
