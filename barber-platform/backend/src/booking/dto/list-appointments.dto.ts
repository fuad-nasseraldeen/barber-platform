import { Transform } from 'class-transformer';
import { IsUUID, IsOptional, IsDateString, IsIn } from 'class-validator';

export class ListAppointmentsQueryDto {
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

  @IsOptional()
  @IsIn(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
  status?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  page?: number;
}
