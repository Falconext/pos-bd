import { IsOptional, IsString, IsNumber, IsEnum, IsIn, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export enum TipoCaja {
  APERTURA = 'APERTURA',
  CIERRE = 'CIERRE',
  INGRESO = 'INGRESO',
  EGRESO = 'EGRESO',
}

const TURNOS_VALIDOS = ['MAÑANA', 'TARDE', 'NOCHE'] as const;

export class AperturaCajaDto {
  @IsNumber()
  @Min(0, { message: 'El monto inicial no puede ser negativo' })
  @Transform(({ value }) => parseFloat(value) || 0)
  montoInicial: number;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsIn(TURNOS_VALIDOS, { message: 'El turno debe ser MAÑANA, TARDE o NOCHE' })
  turno?: string;
}

export class CierreCajaDto {
  @IsNumber()
  @Min(0, { message: 'El monto de efectivo no puede ser negativo' })
  @Transform(({ value }) => parseFloat(value) || 0)
  montoEfectivo: number;

  @IsNumber()
  @Min(0, { message: 'El monto de Yape no puede ser negativo' })
  @Transform(({ value }) => parseFloat(value) || 0)
  montoYape: number;

  @IsNumber()
  @Min(0, { message: 'El monto de Plin no puede ser negativo' })
  @Transform(({ value }) => parseFloat(value) || 0)
  montoPlin: number;

  @IsNumber()
  @Min(0, { message: 'El monto de transferencia no puede ser negativo' })
  @Transform(({ value }) => parseFloat(value) || 0)
  montoTransferencia: number;

  @IsNumber()
  @Min(0, { message: 'El monto de tarjeta no puede ser negativo' })
  @Transform(({ value }) => parseFloat(value) || 0)
  montoTarjeta: number;

  @IsOptional()
  @IsString()
  observaciones?: string;
}

export class MovimientoCajaDto {
  @IsEnum(TipoCaja)
  tipoMovimiento: TipoCaja;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => parseFloat(value))
  monto?: number;

  @IsOptional()
  @IsString()
  medioPago?: string;

  @IsOptional()
  @IsString()
  concepto?: string;

  @IsOptional()
  @IsString()
  observaciones?: string;
}

export class EstadoCajaDto {
  @IsOptional()
  @IsString()
  fechaInicio?: string;

  @IsOptional()
  @IsString()
  fechaFin?: string;
}