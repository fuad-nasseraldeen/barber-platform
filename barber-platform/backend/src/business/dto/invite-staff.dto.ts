import { IsEmail, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class InviteStaffDto {
  @IsUUID()
  businessId: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsIn(['manager', 'staff', 'customer'])
  role: 'manager' | 'staff' | 'customer';

  @IsOptional()
  @IsString()
  message?: string;
}
