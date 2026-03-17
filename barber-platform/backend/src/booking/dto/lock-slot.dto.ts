import {
  IsUUID,
  IsDateString,
  IsString,
  Matches,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';

export class LockSlotDto {
  @IsUUID()
  businessId: string;

  @IsUUID()
  staffId: string;

  @IsUUID()
  serviceId: string;

  @IsDateString()
  date: string; // YYYY-MM-DD

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime must be HH:mm format (24h)',
  })
  startTime: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sessionId?: string; // client-provided session for lock ownership
}
