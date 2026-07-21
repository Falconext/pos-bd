import { Transform, Type } from 'class-transformer';
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
  @IsOptional()
  @IsInt()
  productoId?: number | null;

  @Transform(({ value }) => Math.round(Number(value) * 1000) / 1000)
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

  // Precio unitario de lista (incl. IGV) ANTES del descuento por ítem. Solo se usa para
  // calcular el monto de descuento a mostrar en el ticket; nuevoValorUnitario ya viene con
  // el descuento aplicado.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioUnitarioOriginal?: number;

  // Farmacia: lote específico a descontar (si no se provee, usa FEFO automático)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  loteId?: number;

  // Fraccionamiento: unidad de venta cuando difiere de la unidad base del producto
  @IsOptional()
  @IsString()
  unidadVenta?: string;

  // Farmacia: datos de receta médica
  @IsOptional()
  @IsString()
  numeroReceta?: string;

  @IsOptional()
  @IsString()
  dniPaciente?: string;

  @IsOptional()
  @IsString()
  nombrePaciente?: string;

  @IsOptional()
  @IsString()
  medicoNombre?: string;

  // FKs opcionales — enlazan con entidades Doctor/Cliente registradas
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  medicoId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pacienteId?: number;

  @IsOptional()
  numerosSerie?: string | string[];
}

export class CrearComprobanteDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sedeId?: number;

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
  cotizMoneda?: string;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsString()
  medioPago?: string;

  @IsOptional()
  paymentDetails?: any;

  @IsOptional()
  @IsArray()
  splitPayments?: any[];

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

  // Descuento global enviado por los clientes (web/mobile/desktop).
  // El cálculo real usa montoDescuentoGlobal; se acepta para no rechazar el payload.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  descuento?: number;

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
  @IsString()
  fechaVencimientoCredito?: string;

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

  // Conversión desde informal (NV, TICKET, etc.) al formal.
  // Cuando se provee, el stock NO se descuenta porque ya fue descontado al crear el informal.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  comprobanteOrigenId?: number;
}
