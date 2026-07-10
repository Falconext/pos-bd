import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class OauthSigninDto {
  @IsIn(['google', 'github'])
  provider!: 'google' | 'github';

  @IsString()
  providerId!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
