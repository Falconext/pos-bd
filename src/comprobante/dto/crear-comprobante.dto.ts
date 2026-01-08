import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class DetalleDto {
  @IsInt()
  productoId: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  cantidad: number;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nuevoValorUnitario: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  descuento?: number;
}

export class CrearComprobanteDto {
  @IsInt()
  tipoOperacionId: number;

  @IsString()
  @IsNotEmpty()
  tipoDoc: string; // '01','03','07','08','TICKET','NV','...'

  @IsDateString()
  fechaEmision: string;

  @IsString()
  formaPagoTipo: string;

  @IsString()
  formaPagoMoneda: string;

  @IsString()
  tipoMoneda: string; // 'PEN','USD'

  @IsOptional()
  @IsInt()
  clienteId?: number;

  @IsString()
  clienteName: string;

  @IsString()
  leyenda: string;

  // Configuración de cotización
  @IsOptional()
  @IsBoolean()
  cotizIncluirImagenes?: boolean;

  @IsOptional()
  @IsNumber()
  cotizDescuento?: number;

  @IsOptional()
  @IsNumber()
  cotizVigencia?: number;

  @IsOptional()
  @IsString()
  cotizFirmante?: string;

  @IsOptional()
  @IsString()
  cotizTerminos?: string;

  @IsOptional()
  @IsString()
  cotizTipoPago?: string;

  @IsOptional()
  @IsNumber()
  cotizAdelanto?: number;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsString()
  medioPago?: string;

  @IsOptional()
  @IsString()
  tipDocAfectado?: string;

  @IsOptional()
  @IsString()
  numDocAfectado?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  mtoOperInafectas?: number;

  @IsOptional()
  @IsInt()
  motivoId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  montoDescuentoGlobal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  montoInteresMora?: number;

  @IsOptional()
  @IsString()
  descripcionInteresMora?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  adelanto?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vuelto?: number;

  @IsOptional()
  @IsDateString()
  fechaRecojo?: string;

  // Campos de Detracciones
  @IsOptional()
  @IsInt()
  tipoDetraccionId?: number;

  @IsOptional()
  @IsInt()
  medioPagoDetraccionId?: number;

  @IsOptional()
  @IsString()
  cuentaBancoNacion?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  porcentajeDetraccion?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  montoDetraccion?: number;

  @IsOptional()
  @IsArray()
  cuotas?: any[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  retencionMonto?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  retencionPorcentaje?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetalleDto)
  detalles: DetalleDto[];
}
