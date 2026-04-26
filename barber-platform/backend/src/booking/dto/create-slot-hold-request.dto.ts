import {
  IsUUID,
  IsDateString,
  IsString,
  Matches,
  IsOptional,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Reserve a slot (short TTL). Follow with POST /appointments/book using returned hold id. */
export class CreateSlotHoldRequestDto {
  @IsUUID()
  businessId: string;

  @IsUUID()
  staffId: string;

  @IsUUID()
  serviceId: string;

  @IsUUID()
  customerId: string;

  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime must be HH:mm format (24h)',
  })
  startTime: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  durationMinutes: number;
}
