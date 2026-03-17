import { IsUUID, IsDateString, Matches } from 'class-validator';

export class CreateStaffBreakExceptionDto {
  @IsUUID()
  staffId: string;

  @IsUUID()
  businessId: string;

  @IsDateString()
  date: string; // YYYY-MM-DD

  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'startTime must be HH:mm 24h format',
  })
  startTime: string;

  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'endTime must be HH:mm 24h format',
  })
  endTime: string;
}

export class CreateStaffBreakExceptionBulkDto {
  @IsUUID()
  staffId: string;

  @IsUUID()
  businessId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
  startTime: string;

  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
  endTime: string;

  /** DAILY = every day in range, WEEKLY = same weekday in range, ONCE = single day (startDate=endDate) */
  recurrence: 'ONCE' | 'DAILY' | 'WEEKLY';
}
