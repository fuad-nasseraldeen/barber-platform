import { IsUUID, IsOptional, IsDateString } from 'class-validator';

export class DashboardQueryDto {
  @IsUUID()
  businessId: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
