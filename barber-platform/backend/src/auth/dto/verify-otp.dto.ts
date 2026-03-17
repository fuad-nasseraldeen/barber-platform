import { Transform } from 'class-transformer';
import { IsE164, normalizePhone } from '../../common/validators/phone.validator';
import { IsString, Length, IsOptional } from 'class-validator';

export class VerifyOtpDto {
  @Transform(({ value }) => (typeof value === 'string' ? normalizePhone(value) : value))
  @IsE164()
  phone: string;

  @IsString()
  @Length(6, 6, { message: 'OTP must be 6 digits' })
  code: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}
