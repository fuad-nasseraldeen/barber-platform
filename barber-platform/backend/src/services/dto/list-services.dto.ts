import { IsUUID, IsOptional, IsIn } from 'class-validator';

export class ListServicesQueryDto {
  @IsUUID()
  businessId: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  includeInactive?: string;
}
