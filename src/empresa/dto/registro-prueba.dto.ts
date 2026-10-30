import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Lo único que acepta el autoregistro público. Plan, vencimiento, credenciales
 * de facturación o de WhatsApp los decide el servidor: si viajaran en el cuerpo,
 * cualquiera podría darse un plan pagado o un vencimiento en 2099.
 */
export class RegistroPruebaDto {
  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombreNegocio: string;

  @Transform(recortar)
  @Matches(/^(10|15|17|20)\d{9}$/, { message: 'El RUC debe tener 11 dígitos' })
  ruc: string;

  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Correo inválido' })
  @MaxLength(120)
  email: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @Matches(/^9\d{8}$/, { message: 'El celular debe tener 9 dígitos y empezar con 9' })
  celular: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(72)
  password: string;

  @IsIn(['start', 'pro', 'scale'])
  plan: 'start' | 'pro' | 'scale';

  @IsOptional()
  @IsIn(['falconext', 'krezka'])
  brand?: 'falconext' | 'krezka';

  /** Trampa para bots: un humano nunca ve ni llena este campo. */
  @IsOptional()
  @IsString()
  sitio?: string;
}
