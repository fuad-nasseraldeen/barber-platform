import { IsUUID, IsInt, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class StaffAssignmentDto {
  @IsUUID()
  staffId: string;

  @IsInt()
  @Min(1)
  @Max(480)
  @Type(() => Number)
  durationMinutes: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price: number;
}
