import { IsUUID, IsOptional, IsString, MaxLength } from 'class-validator';

export class ListCustomersQueryDto {
  @IsUUID()
  businessId: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
