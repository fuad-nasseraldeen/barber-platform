import { IsString, IsOptional, IsUUID } from 'class-validator';

export class InviteStaffByPhoneDto {
  @IsUUID()
  businessId: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}
