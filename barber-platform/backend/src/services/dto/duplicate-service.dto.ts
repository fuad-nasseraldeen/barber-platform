import { IsUUID } from 'class-validator';

export class DuplicateServiceDto {
  @IsUUID()
  businessId: string;

  @IsUUID()
  targetBranchId: string;
}
