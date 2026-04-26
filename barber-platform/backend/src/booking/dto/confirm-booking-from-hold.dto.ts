import {
  IsUUID,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Finalize booking: every appointment must be created from a live SlotHold. */
export class ConfirmBookingFromHoldDto {
  @IsUUID()
  businessId: string;

  @IsUUID()
  slotHoldId: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}
