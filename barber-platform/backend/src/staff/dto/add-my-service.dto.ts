import {
  IsUUID,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsString,
  MinLength,
  MaxLength,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AddMyServiceDto {
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  newServiceName?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(480)
  durationMinutes: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}
