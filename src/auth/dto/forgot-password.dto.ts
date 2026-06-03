import { IsEmail, IsOptional, IsString } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido' })
  email: string;

  @IsOptional()
  @IsString()
  brand?: string;
}
