import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

/** Medios con los que hoy paga un cliente directo. MERCADO_PAGO queda listo
 *  para cuando el webhook de la pasarela confirme el cobro por su cuenta. */
export const MEDIOS_PAGO_COBRO = [
  'MERCADO_PAGO',
  'YAPE',
  'PLIN',
  'TRANSFERENCIA',
  'EFECTIVO',
  'OTRO',
] as const;

export class RegistrarPagoCobroDto {
  @IsOptional()
  @IsIn(MEDIOS_PAGO_COBRO as unknown as string[])
  medioPago?: string;

  /** Nº de operación o id del pago en la pasarela. */
  @IsOptional()
  @IsString()
  referencia?: string;

  /** Solo si entró un monto distinto al emitido (ajuste, descuento pactado). */
  @IsOptional()
  @IsNumber()
  monto?: number;

  @IsOptional()
  @IsDateString()
  fechaCobro?: string;
}

/** Un pago de un mes ya pasado, para armar el historial hacia atrás. */
export class RegistrarPagoHistoricoDto {
  @IsInt()
  empresaId: number;

  /** AAAA-MM del mes que se está cargando. */
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'El periodo debe tener el formato AAAA-MM' })
  periodo: string;

  @IsNumber()
  monto: number;

  @IsDateString()
  fechaCobro: string;

  @IsOptional()
  @IsIn(MEDIOS_PAGO_COBRO as unknown as string[])
  medioPago?: string;

  @IsOptional()
  @IsString()
  referencia?: string;
}
