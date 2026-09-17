import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const OPERACION_TIPOS = [
  'VENTA_INFORMAL',
  'CAJA_APERTURA',
  'CAJA_EGRESO',
  'CAJA_CIERRE',
] as const;
export type OperacionTipo = (typeof OPERACION_TIPOS)[number];

/**
 * Una operación hecha sin conexión en la app móvil. El `uuid` lo genera el
 * teléfono y es la clave de idempotencia; `payload` es EXACTAMENTE el body que
 * la app mandaría al endpoint online equivalente (CrearComprobanteDto,
 * AperturaCajaDto, RegistrarEgresoDto, CierreCajaDto), así el backend aplica
 * las mismas reglas que una operación online.
 */
export class OperacionSyncDto {
  @IsUUID('4')
  uuid: string;

  @IsIn(OPERACION_TIPOS)
  tipo: OperacionTipo;

  /** Hora real en el dispositivo (ISO 8601 con zona). */
  @IsISO8601()
  realizadoEn: string;

  @IsOptional()
  @IsInt()
  sedeId?: number;

  /** uuid de la operación que debe estar OK antes (p. ej. cierre → última venta). */
  @IsOptional()
  @IsUUID('4')
  dependeDe?: string;

  @IsObject()
  payload: Record<string, unknown>;
}

export class SyncOperacionesDto {
  @IsString()
  @MaxLength(64)
  dispositivoId: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  plataforma?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nombreDispositivo?: string;

  /** Cuántas quedan en cola en el teléfono después de este lote (para soporte). */
  @IsOptional()
  @IsInt()
  pendientesRestantes?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OperacionSyncDto)
  operaciones: OperacionSyncDto[];
}

export class DescartarOperacionDto {
  @IsUUID('4')
  uuid: string;

  @IsString()
  @MaxLength(300)
  motivo: string;

  @IsString()
  @MaxLength(64)
  dispositivoId: string;

  @IsIn(OPERACION_TIPOS)
  tipo: OperacionTipo;

  @IsISO8601()
  realizadoEn: string;

  @IsOptional()
  @IsInt()
  sedeId?: number;

  @IsObject()
  payload: Record<string, unknown>;
}

export interface ResultadoOperacionSync {
  uuid: string;
  estado: 'OK' | 'ERROR';
  duplicado?: boolean;
  bloqueante?: boolean;
  codigo?: string;
  mensaje?: string;
  resultado?: {
    comprobanteId?: number;
    serie?: string;
    correlativo?: number;
    tipoDoc?: string;
    estadoSunat?: string;
    movimientoCajaId?: number;
    avisos?: string[];
  };
}
