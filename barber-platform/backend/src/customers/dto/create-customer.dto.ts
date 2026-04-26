import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsIn,
  Matches,
  MaxLength,
  MinLength,
  Allow,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCustomerDto {
  @IsUUID()
  businessId: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Legacy key from older clients / proxies. Ignored — server always assigns internal placeholder email. */
  @Allow()
  email?: unknown;

  /** Accepted and ignored (for future admin flows). Not validated; not persisted. */
  @Allow()
  adminReserved?: unknown;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @Transform(trim)
  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phone: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'tagColor must be hex e.g. #3B82F6' })
  tagColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
