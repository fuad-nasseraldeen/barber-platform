import { IsUUID } from 'class-validator';

export class CancelWaitlistDto {
  @IsUUID()
  businessId: string;
}
