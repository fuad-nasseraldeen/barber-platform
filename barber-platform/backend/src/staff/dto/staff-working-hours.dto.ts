import { IsUUID, IsInt, Min, Max, Matches } from 'class-validator';

export class StaffWorkingHoursDto {
  @IsUUID()
  staffId: string;

  @IsUUID()
  businessId: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number; // 0=Sunday, 6=Saturday

  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'startTime must be HH:mm 24h format',
  })
  startTime: string;

  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'endTime must be HH:mm 24h format',
  })
  endTime: string;
}
