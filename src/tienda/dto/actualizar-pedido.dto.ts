import { IsEnum, IsOptional, IsNumber, IsString, Min } from 'class-validator';

export enum EstadoPedidoTienda {
  PENDIENTE = 'PENDIENTE',
  CONFIRMADO = 'CONFIRMADO',
  EN_PREPARACION = 'EN_PREPARACION',
  LISTO = 'LISTO',
  ENTREGADO = 'ENTREGADO',
  CANCELADO = 'CANCELADO',
}

export class ActualizarEstadoPedidoDto {
  @IsEnum(EstadoPedidoTienda)
  @IsOptional()
  estado?: EstadoPedidoTienda;

  @IsNumber()
  @IsOptional()
  usuarioConfirma?: number;

  @IsString()
  @IsOptional()
  estadoEntrega?: string;

  @IsString()
  @IsOptional()
  agenciaEnvio?: string;

  @IsString()
  @IsOptional()
  estadoEnvio?: string;

  @IsString()
  @IsOptional()
  numeroTracking?: string;

  @IsString()
  @IsOptional()
  vendedorNombre?: string;

  @IsString()
  @IsOptional()
  notasInternas?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  montoPagado?: number;
}
