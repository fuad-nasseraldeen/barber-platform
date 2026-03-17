import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { IsE164, normalizePhone } from '../../common/validators/phone.validator';

export class RequestOtpDto {
  @Transform(({ value }) => (typeof value === 'string' ? normalizePhone(value) : value))
  @IsE164()
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(11)
  senderId?: string;
}
