import { IsUUID, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { StaffAssignmentDto } from './staff-assignment.dto';

export class AssignStaffToServiceDto {
  @IsUUID()
  businessId: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  staffIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffAssignmentDto)
  staffAssignments?: StaffAssignmentDto[];
}
