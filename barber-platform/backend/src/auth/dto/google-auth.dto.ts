import { IsString, IsNotEmpty } from 'class-validator';

export class GoogleAuthDto {
  @IsString()
  @IsNotEmpty({ message: 'credential is required' })
  credential: string;

  @IsString()
  @IsNotEmpty({ message: 'nonce is required' })
  nonce: string;
}
