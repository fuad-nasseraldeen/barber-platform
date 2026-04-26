import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsIn,
  Matches,
  MaxLength,
  Allow,
} from 'class-validator';

export class UpdateCustomerDto {
  @IsUUID()
  businessId: string;

  /** Legacy key; ignored — email is not updated via this API. */
  @Allow()
  email?: unknown;

  /** Accepted and ignored (for future admin flows). Not validated; not persisted. */
  @Allow()
  adminReserved?: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'tagColor must be hex e.g. #3B82F6' })
  tagColor?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
