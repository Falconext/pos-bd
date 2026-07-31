import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * DTO para IMPORTAR una Nota de venta (comprobante informal `tipoDoc = 'NV'`)
 * histórica. No se envía nada a SUNAT: solo se registra el documento con su
 * serie/correlativo ORIGINAL. Pensado para cargar el movimiento del año.
 *
 * Los flags `afectarStock` / `afectarCaja` vienen APAGADOS por defecto: la
 * carga histórica no debe mover inventario ni caja salvo indicación expresa.
 */
export class ImportarNotaVentaDetalleDto {
  // Código o código de barras del producto a matchear contra el catálogo.
  @IsOptional()
  @IsString()
  productoCodigo?: string;

  // Descripción del producto (fallback de match y texto de la línea).
  @IsOptional()
  @IsString()
  descripcion?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  cantidad: number;

  // Precio de venta CON IGV por unidad.
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioUnitario: number;
}

export class ImportarNotaVentaDto {
  // Solo se admiten Notas de venta.
  @IsOptional()
  @IsIn(['NV'])
  tipoDoc?: 'NV';

  @IsString()
  @IsNotEmpty()
  serie: string;

  @IsString()
  @IsNotEmpty()
  correlativo: string;

  // Fecha de emisión del documento histórico (YYYY-MM-DD). Se permite 2026.
  @IsString()
  @IsNotEmpty()
  fechaEmision: string;

  // Cliente: RUC (11 dígitos) o DNI (8 dígitos). Opcional → CLIENTES VARIOS.
  @IsOptional()
  @IsString()
  clienteNumDoc?: string;

  @IsOptional()
  @IsIn(['DNI', 'RUC'])
  clienteTipoDoc?: 'DNI' | 'RUC';

  @IsOptional()
  @IsString()
  clienteNombre?: string;

  // EFECTIVO / YAPE / PLIN / TRANSFERENCIA / TARJETA. Default EFECTIVO.
  @IsOptional()
  @IsString()
  medioPago?: string;

  // PAGADO / PENDIENTE. Default PAGADO.
  @IsOptional()
  @IsString()
  estadoPago?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportarNotaVentaDetalleDto)
  detalles: ImportarNotaVentaDetalleDto[];

  @IsOptional()
  @IsBoolean()
  afectarStock?: boolean;

  @IsOptional()
  @IsBoolean()
  afectarCaja?: boolean;
}
