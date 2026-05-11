import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido' })
  email: string;
}
