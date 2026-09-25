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
  IsNotEmpty,
  ArrayMinSize,
  Matches,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

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
  MERCADO_PAGO = 'MERCADO_PAGO',
}

export enum TipoEntrega {
  RECOJO = 'RECOJO',
  ENVIO = 'ENVIO',
}

export class CrearPedidoDto {
  // Nombre y teléfono son lo único que tiene la tienda para ubicar al cliente:
  // no se aceptan vacíos ni solo espacios (la validación vivía solo en el front).
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'El nombre del cliente es obligatorio' })
  clienteNombre: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'El teléfono del cliente es obligatorio' })
  @Matches(/^(?:\D*\d){6,}\D*$/, {
    message: 'El teléfono debe tener al menos 6 dígitos',
  })
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
  @ArrayMinSize(1, { message: 'El pedido debe tener al menos un producto' })
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

  /** Token que devuelve el formulario de Niubiz tras cargar la tarjeta. */
  @IsString()
  @IsOptional()
  niubizTransactionToken?: string;

  /** Número de compra que devolvió la sesión: Niubiz exige el mismo al autorizar. */
  @IsOptional()
  @IsString()
  niubizPurchaseNumber?: string;

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
