import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateClienteDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsNotEmpty()
  @IsEnum(['DNI', 'RUC', 'CE', 'PASAPORTE', 'OTRO'])
  tipoDoc: 'DNI' | 'RUC' | 'CE' | 'PASAPORTE' | 'OTRO';

  @IsString()
  @IsNotEmpty()
  nroDoc: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  direccion?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEmail()
  email?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  telefono?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  ubigeo: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  departamento: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  provincia: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  distrito: string;

  @IsEnum(['CLIENTE', 'CLIENTE_PROVEEDOR', 'PROVEEDOR', 'EMPRESA'])
  persona?: 'CLIENTE' | 'CLIENTE_PROVEEDOR' | 'PROVEEDOR' | 'EMPRESA';

  // Campos médicos opcionales (farmacia/clínica)
  @IsOptional()
  @IsString()
  grupoSanguineo?: string;

  @IsOptional()
  @IsString()
  alergias?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  fechaNacimiento?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  medicoTratanteId?: number;
}
