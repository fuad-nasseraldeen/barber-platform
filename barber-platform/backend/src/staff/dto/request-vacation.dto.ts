import { IsDateString, IsOptional, IsIn, IsBoolean, Matches } from 'class-validator';

export class RequestVacationDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'startTime must be HH:mm' })
  startTime?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'endTime must be HH:mm' })
  endTime?: string;

  @IsOptional()
  @IsIn(['vacation', 'sick', 'personal'])
  reason?: string;

  @IsOptional()
  @IsBoolean()
  isAllDay?: boolean;
}
