import { IsString, IsOptional, IsInt, IsEnum, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum TipoCombustibleLogistica {
  GASOLINA = 'GASOLINA',
  DIESEL = 'DIESEL',
  GLP = 'GLP',
  GNV = 'GNV',
  ELECTRICO = 'ELECTRICO',
  HIBRIDO = 'HIBRIDO',
}

export class CreateCombustibleDto {
  @Type(() => Number)
  @IsInt()
  vehiculoId: number;

  @IsString()
  fecha: string; // ISO date string

  @IsOptional()
  @IsEnum(TipoCombustibleLogistica)
  tipoCombustible?: TipoCombustibleLogistica;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cantidadLitros: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costoTotal: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costoPorLitro?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometroKm?: number;

  @IsOptional()
  @IsString()
  estacion?: string;

  @IsOptional()
  @IsString()
  numeroComprobante?: string;

  @IsOptional()
  @IsString()
  evidenciaUrl?: string;

  @IsOptional()
  @IsString()
  notas?: string;
}
