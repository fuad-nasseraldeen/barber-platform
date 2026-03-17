import { IsUUID } from 'class-validator';

export class ListBranchesQueryDto {
  @IsUUID()
  businessId: string;
}
