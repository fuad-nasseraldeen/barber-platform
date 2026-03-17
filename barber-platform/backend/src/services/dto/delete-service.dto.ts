import { IsUUID } from 'class-validator';

export class DeleteServiceDto {
  @IsUUID()
  businessId: string;
}
