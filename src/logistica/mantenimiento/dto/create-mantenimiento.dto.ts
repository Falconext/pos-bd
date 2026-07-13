import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum TipoMantenimientoLogistica {
  PREVENTIVO = 'PREVENTIVO',
  CORRECTIVO = 'CORRECTIVO',
  EMERGENCIA = 'EMERGENCIA',
  INSPECCION = 'INSPECCION',
}

export enum EstadoMantenimientoLogistica {
  PROGRAMADO = 'PROGRAMADO',
  EN_PROCESO = 'EN_PROCESO',
  COMPLETADO = 'COMPLETADO',
  CANCELADO = 'CANCELADO',
}

export class CreateMantenimientoDto {
  @Type(() => Number)
  @IsInt()
  vehiculoId: number;

  @IsOptional()
  @IsEnum(TipoMantenimientoLogistica)
  tipo?: TipoMantenimientoLogistica;

  @IsOptional()
  @IsEnum(EstadoMantenimientoLogistica)
  estado?: EstadoMantenimientoLogistica;

  @IsString()
  descripcion: string;

  @IsOptional()
  @IsString()
  taller?: string;

  @IsString()
  fechaProgramada: string; // ISO date string

  @IsOptional()
  @IsString()
  fechaRealizado?: string; // ISO date string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costo?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometroKm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  proximoMantenimientoKm?: number;

  @IsOptional()
  @IsString()
  proximoMantenimientoFecha?: string; // ISO date string

  @IsOptional()
  @IsString()
  evidenciaUrl?: string;

  @IsOptional()
  @IsString()
  notas?: string;
}
