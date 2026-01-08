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
  @IsOptional()
  providerId?: string;

  @IsOptional()
  @IsBoolean()
  esAgenteRetencion?: boolean;

  @ValidateNested()
  @Type(() => UsuarioDto)
  usuario: UsuarioDto;
}
