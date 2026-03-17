import { IsUUID } from 'class-validator';

export class ListAutomationsDto {
  @IsUUID()
  businessId: string;
}
