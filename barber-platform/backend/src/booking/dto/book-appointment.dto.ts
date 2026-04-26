import { IsIn, IsOptional } from 'class-validator';
import { ConfirmBookingFromHoldDto } from './confirm-booking-from-hold.dto';

/** Customer finalizes a held slot (same body as admin create-from-hold). */
export class BookAppointmentDto extends ConfirmBookingFromHoldDto {
  /** Retained for API compat; response shape unchanged. */
  @IsOptional()
  @IsIn(['full', 'minimal'])
  responseMode?: 'full' | 'minimal';
}
