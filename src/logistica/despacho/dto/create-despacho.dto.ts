import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsArray,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum EstadoDespachoLogistica {
  BORRADOR = 'BORRADOR',
  PLANIFICADO = 'PLANIFICADO',
  APROBADO = 'APROBADO',
  CARGANDO = 'CARGANDO',
  LISTO = 'LISTO',
  EN_CURSO = 'EN_CURSO',
  COMPLETADO = 'COMPLETADO',
  CANCELADO = 'CANCELADO',
}

export class CreateDespachoLogisticaDto {
  @IsInt()
  @Type(() => Number)
  almacenOrigenId: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  almacenDestinoId?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  conductorId?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  vehiculoId?: number;

  @IsOptional()
  @IsString()
  nombre?: string;

  @IsString()
  fechaProgramada: string; // ISO string

  @IsOptional()
  @IsString()
  horaInicioProgramada?: string;

  @IsOptional()
  @IsString()
  notas?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  pedidoIds?: number[];
}

export class UpdateEstadoDespachoDto {
  @IsEnum(EstadoDespachoLogistica)
  estado: EstadoDespachoLogistica;

  @IsOptional()
  @IsString()
  motivo?: string;
}
