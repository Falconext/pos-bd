import {
  IsDateString,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
  IsBoolean,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

class UsuarioDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsNotEmpty()
  dni: string;

  @IsString()
  @IsNotEmpty()
  celular: string;
}

export class CreateEmpresaDto {
  @IsString()
  @IsNotEmpty()
  ruc: string;

  @IsString()
  @IsNotEmpty()
  razonSocial: string;

  @IsString()
  @IsNotEmpty()
  direccion: string;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsInt()
  planId?: number;

  @IsOptional()
  esPrueba?: boolean;

  @IsOptional()
  @IsString()
  tipoEmpresa?: 'FORMAL' | 'INFORMAL';

  @IsString()
  departamento: string;

  @IsString()
  provincia: string;

  @IsString()
  distrito: string;

  @IsString()
  ubigeo: string;

  @IsInt()
  rubroId: number;

  @IsString()
  nombreComercial: string;

  // En backend original viene dd/MM/yyyy como string
  @IsString()
  fechaActivacion: string;

  @IsOptional()
  @IsString()
  fechaExpiracion?: string;

  // Campos para integración SUNAT (opcionales)
  @IsOptional()
  @IsString()
  providerToken?: string;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['QPSE', 'APISUNAT', 'JAMBLE'])
  billingProvider?: 'QPSE' | 'APISUNAT' | 'JAMBLE';

  @IsOptional()
  @IsString()
  billingApiBaseUrl?: string;

  @IsOptional()
  @IsString()
  billingApiDemoBaseUrl?: string;

  @IsOptional()
  @IsString()
  billingApiToken?: string;

  @IsOptional()
  @IsString()
  billingApiUser?: string;

  @IsOptional()
  @IsString()
  billingApiPassword?: string;

  @IsOptional()
  @IsBoolean()
  esAgenteRetencion?: boolean;

  @IsOptional()
  @IsBoolean()
  usaCodigoBarrasManual?: boolean;

  @IsOptional()
  @IsBoolean()
  usarPrecioLoteFefo?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['falconext', 'krezka'])
  brand?: string;

  @IsOptional()
  @IsString()
  @IsIn(['facturacion', 'hotel'])
  producto?: string;

  @IsOptional()
  @IsString()
  usuarioPse?: string;

  @IsOptional()
  @IsString()
  contrasenaPse?: string;

  @IsOptional()
  @IsString()
  @IsIn(['PLATFORM', 'EMPRESA', 'DISABLED'])
  whatsappProvider?: 'PLATFORM' | 'EMPRESA' | 'DISABLED';

  @IsOptional()
  @IsString()
  whatsappApiToken?: string;

  @IsOptional()
  @IsString()
  whatsappPhoneNumberId?: string;

  @IsOptional()
  @IsString()
  whatsappBusinessId?: string;

  @IsOptional()
  @IsBoolean()
  whatsappActivo?: boolean;

  @IsOptional()
  @IsBoolean()
  usaDemo?: boolean;

  @ValidateNested()
  @Type(() => UsuarioDto)
  usuario: UsuarioDto;
}
