import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
  Matches,
} from 'class-validator';

/** One day in the weekly schedule (omit from the list or leave times empty = day off). */
export class StaffWorkingHoursDayDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsOptional()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'startTime must be HH:mm 24h format',
  })
  startTime?: string;

  @IsOptional()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'endTime must be HH:mm 24h format',
  })
  endTime?: string;
}

export class StaffWorkingHoursBatchDto {
  @IsUUID()
  staffId: string;

  @IsUUID()
  businessId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffWorkingHoursDayDto)
  days: StaffWorkingHoursDayDto[];
}
