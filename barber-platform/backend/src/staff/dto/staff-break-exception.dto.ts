import { IsUUID, IsDateString, Matches, IsIn, IsOptional } from 'class-validator';

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

  /** Admin: TIME_BLOCK = calendar "block time" (gray). Default BREAK = same as הפסקה (orange). */
  @IsOptional()
  @IsIn(['BREAK', 'TIME_BLOCK'])
  kind?: 'BREAK' | 'TIME_BLOCK';
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
  @IsIn(['ONCE', 'DAILY', 'WEEKLY'])
  recurrence: 'ONCE' | 'DAILY' | 'WEEKLY';
}

/** POST /staff/me/breaks — staffId from JWT (must be a class for ValidationPipe whitelist). */
export class CreateStaffBreakExceptionMeDto {
  @IsUUID()
  businessId: string;

  @IsDateString()
  date: string;

  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'startTime must be HH:mm 24h format',
  })
  startTime: string;

  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'endTime must be HH:mm 24h format',
  })
  endTime: string;
}

/** POST /staff/me/breaks/bulk — staffId from JWT */
export class CreateStaffBreakExceptionBulkMeDto {
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

  @IsIn(['ONCE', 'DAILY', 'WEEKLY'])
  recurrence: 'ONCE' | 'DAILY' | 'WEEKLY';
}
