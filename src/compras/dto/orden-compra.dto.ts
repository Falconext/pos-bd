import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DetalleOrdenCompraDto {
  @IsOptional()
  @IsNumber()
  productoId?: number;

  @IsString()
  descripcion: string;

  @IsNumber()
  cantidad: number;

  // Precio pactado con el proveedor SIN IGV
  @IsNumber()
  precioUnitario: number;
}

export class CrearOrdenCompraDto {
  @IsNumber()
  proveedorId: number;

  @IsOptional()
  @IsNumber()
  sedeId?: number;

  @IsOptional()
  @IsDateString()
  fechaEmision?: string;

  @IsOptional()
  @IsDateString()
  fechaEntrega?: string;

  @IsOptional()
  @IsString()
  moneda?: string;

  @IsOptional()
  @IsNumber()
  tipoCambio?: number;

  // Si es false, la orden no lleva IGV (proveedor RUS, exonerado, etc.)
  @IsOptional()
  @IsBoolean()
  aplicaIgv?: boolean;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsString()
  condicionesPago?: string;

  @IsOptional()
  @IsString()
  lugarEntrega?: string;

  @IsOptional()
  @IsIn(['BORRADOR', 'EMITIDA'])
  estado?: 'BORRADOR' | 'EMITIDA';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetalleOrdenCompraDto)
  detalles: DetalleOrdenCompraDto[];
}

export class ActualizarOrdenCompraDto extends CrearOrdenCompraDto {}

/** Datos de la factura del proveedor al recibir la mercadería. */
export class RecibirOrdenCompraDto {
  @IsString()
  tipoDoc: string;

  @IsString()
  serie: string;

  @IsString()
  numero: string;

  @IsDateString()
  fechaEmision: string;

  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;

  @IsOptional()
  @IsNumber()
  sedeId?: number;

  @IsOptional()
  @IsString()
  formaPago?: string; // CONTADO o CREDITO

  @IsOptional()
  @IsNumber()
  montoPagadoInicial?: number;

  @IsOptional()
  @IsString()
  metodoPagoInicial?: string;
}
