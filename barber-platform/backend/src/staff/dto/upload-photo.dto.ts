import { IsUUID } from 'class-validator';

export class UploadPhotoQueryDto {
  @IsUUID()
  businessId: string;
}
