import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsNumber,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum EstadoVehiculoLogistica {
  DISPONIBLE = 'DISPONIBLE',
  EN_USO = 'EN_USO',
  MANTENIMIENTO = 'MANTENIMIENTO',
  AVERIADO = 'AVERIADO',
  FUERA_SERVICIO = 'FUERA_SERVICIO',
}

export enum TipoCombustibleLogistica {
  GASOLINA = 'GASOLINA',
  DIESEL = 'DIESEL',
  GLP = 'GLP',
  GNV = 'GNV',
  ELECTRICO = 'ELECTRICO',
  HIBRIDO = 'HIBRIDO',
}

export class CreateVehiculoLogisticaDto {
  @IsInt()
  @Type(() => Number)
  tipoVehiculoId: number;

  @IsString()
  placa: string;

  @IsString()
  marca: string;

  @IsOptional()
  @IsString()
  modelo?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  anio?: number;

  @IsOptional()
  @IsEnum(EstadoVehiculoLogistica)
  estado?: EstadoVehiculoLogistica;

  @IsNumber()
  @Type(() => Number)
  capacidadPesoKg: number;

  @IsNumber()
  @Type(() => Number)
  capacidadVolumenM3: number;

  @IsEnum(TipoCombustibleLogistica)
  tipoCombustible: TipoCombustibleLogistica;

  @IsOptional()
  @IsBoolean()
  tieneRefrigeracion?: boolean;

  @IsOptional()
  @IsBoolean()
  tieneGPSIntegrado?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  odometroActual?: number;
}
