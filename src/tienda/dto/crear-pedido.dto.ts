import {
  IsString,
  IsEmail,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ItemPedidoDto {
  @IsNumber()
  productoId: number;

  @IsNumber()
  @Min(1)
  cantidad: number;

  @IsString()
  @IsOptional()
  observacion?: string;
}

export enum MedioPagoTienda {
  YAPE = 'YAPE',
  PLIN = 'PLIN',
  EFECTIVO = 'EFECTIVO',
  TRANSFERENCIA = 'TRANSFERENCIA',
  TARJETA = 'TARJETA',
}

export enum TipoEntrega {
  RECOJO = 'RECOJO',
  ENVIO = 'ENVIO',
}

export class CrearPedidoDto {
  @IsString()
  clienteNombre: string;

  @IsString()
  clienteTelefono: string;

  @IsEmail()
  @IsOptional()
  clienteEmail?: string;

  @IsString()
  @IsOptional()
  clienteDireccion?: string;

  @IsString()
  @IsOptional()
  clienteReferencia?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoDto)
  items: ItemPedidoDto[];

  @IsEnum(MedioPagoTienda)
  medioPago: MedioPagoTienda;

  @IsString()
  @IsOptional()
  observaciones?: string;

  @IsString()
  @IsOptional()
  referenciaTransf?: string;

  @IsString()
  @IsOptional()
  culqiToken?: string;

  @IsEmail()
  @IsOptional()
  culqiEmail?: string;

  @IsEnum(TipoEntrega)
  @IsOptional()
  tipoEntrega?: TipoEntrega = TipoEntrega.RECOJO;

  @IsString()
  @IsOptional()
  agenciaEnvio?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  adelanto?: number;
}
