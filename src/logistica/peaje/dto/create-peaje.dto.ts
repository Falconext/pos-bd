import { IsString, IsOptional, IsInt, IsEnum, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum TipoPeajeLogistica {
  PEAJE = 'PEAJE',
  MULTA = 'MULTA',
  INFRACCION = 'INFRACCION',
}

export enum EstadoPeajeLogistica {
  PENDIENTE = 'PENDIENTE',
  PAGADO = 'PAGADO',
  ANULADO = 'ANULADO',
}

export class CreatePeajeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vehiculoId?: number;

  @IsOptional()
  @IsEnum(TipoPeajeLogistica)
  tipo?: TipoPeajeLogistica;

  @IsOptional()
  @IsEnum(EstadoPeajeLogistica)
  estado?: EstadoPeajeLogistica;

  @IsString()
  fecha: string; // ISO date string

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monto: number;

  @IsOptional()
  @IsString()
  lugar?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsString()
  placa?: string;

  @IsOptional()
  @IsString()
  comprobanteUrl?: string;

  @IsOptional()
  @IsString()
  reciboPagoUrl?: string;

  @IsOptional()
  @IsString()
  notas?: string;
}
