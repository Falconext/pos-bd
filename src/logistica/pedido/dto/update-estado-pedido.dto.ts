import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export enum EstadoPedidoLogistica {
  PENDIENTE = 'PENDIENTE',
  VALIDADO = 'VALIDADO',
  ASIGNADO = 'ASIGNADO',
  LISTO_RECOGER = 'LISTO_RECOGER',
  RECOGIDO = 'RECOGIDO',
  EN_TRANSITO = 'EN_TRANSITO',
  LLEGANDO = 'LLEGANDO',
  EN_UBICACION = 'EN_UBICACION',
  ENTREGADO = 'ENTREGADO',
  ENTREGA_PARCIAL = 'ENTREGA_PARCIAL',
  FALLIDO = 'FALLIDO',
  DEVUELTO = 'DEVUELTO',
  REPROGRAMADO = 'REPROGRAMADO',
  CANCELADO = 'CANCELADO',
}

export class UpdateEstadoPedidoDto {
  @IsEnum(EstadoPedidoLogistica)
  estado: EstadoPedidoLogistica;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsString()
  notas?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lng?: number;
}
