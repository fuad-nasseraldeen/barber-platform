import { IsString } from 'class-validator';

export class JoinBusinessDto {
  @IsString()
  token: string;
}
