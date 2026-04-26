import { IsUUID, IsBoolean, IsArray, ArrayUnique } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateServiceBlocksDto {
  @IsUUID()
  businessId: string;

  @IsBoolean()
  @Type(() => Boolean)
  blockAllStaff: boolean;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  blockedStaffIds: string[];
}
