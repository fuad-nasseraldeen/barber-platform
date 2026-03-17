import { Transform } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsUUID, Min, Max } from 'class-validator';

export class UpdateMyServiceItemDto {
  @IsUUID()
  staffServiceId: string;

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
