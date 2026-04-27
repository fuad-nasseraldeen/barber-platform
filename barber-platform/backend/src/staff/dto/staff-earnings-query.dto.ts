import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

export class StaffEarningsQueryDto {
  @IsUUID()
  businessId: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  compareWithPreviousPeriod?: string;
}
