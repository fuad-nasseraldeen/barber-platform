import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsUUID, Min, Max } from 'class-validator';

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return undefined;
}

export class UpdateMyServiceItemDto {
  @IsUUID()
  staffServiceId: string;

  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  allowBooking?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  @IsNumber()
  @Min(1)
  @Max(480)
  durationMinutes?: number;

  @IsOptional()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  @IsNumber()
  @Min(0)
  price?: number;
}

export class UpdateMyServicesDto {
  @IsArray()
  updates: UpdateMyServiceItemDto[];
}
