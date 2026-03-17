import {
  IsUUID,
  IsOptional,
  IsNumber,
  Min,
  IsString,
  IsIn,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaymentIntentDto {
  @IsUUID()
  businessId: string;

  @IsUUID()
  appointmentId: string;

  @IsUUID()
  customerId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  amount: number; // in currency units (e.g. 25.00 for $25)

  @IsOptional()
  @IsString()
  @IsIn(['USD', 'EUR', 'GBP', 'ILS'])
  currency?: string;

  @IsOptional()
  @IsString()
  @IsIn(['DEPOSIT', 'FULL'])
  type?: 'DEPOSIT' | 'FULL';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  returnUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelUrl?: string;
}
