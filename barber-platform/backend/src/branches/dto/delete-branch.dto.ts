import { IsUUID } from 'class-validator';

export class DeleteBranchDto {
  @IsUUID()
  businessId: string;
}
