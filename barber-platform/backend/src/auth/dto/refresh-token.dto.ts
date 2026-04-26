import { IsOptional, IsString } from 'class-validator';

/** Body optional: browser clients use HttpOnly `refresh_token` cookie instead. */
export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
