import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class EditProfileDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @Length(8, 12)
  dni?: string;

  @IsString()
  @IsOptional()
  celular?: string;

  @IsString()
  @IsOptional()
  telefono?: string;
}
