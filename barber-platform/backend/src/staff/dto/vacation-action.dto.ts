import { IsUUID } from 'class-validator';

export class VacationActionDto {
  @IsUUID()
  businessId: string;
}
