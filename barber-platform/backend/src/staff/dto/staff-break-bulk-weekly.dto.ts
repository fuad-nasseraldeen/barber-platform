import { IsUUID, IsArray, ArrayMinSize, IsInt, Min, Max, Matches, IsDateString } from 'class-validator';

export class StaffBreakBulkWeeklyDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  staffIds: string[];

  @IsUUID()
  businessId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek: number[];

  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'startTime must be HH:mm 24h format',
  })
  startTime: string;

  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'endTime must be HH:mm 24h format',
  })
  endTime: string;
}

export class StaffBreakBulkWeeklyRangeDto extends StaffBreakBulkWeeklyDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
