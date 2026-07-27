import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { CrearComprobanteDto } from './crear-comprobante.dto';

/**
 * DTO para IMPORTAR un comprobante YA EMITIDO a SUNAT (registro interno).
 *
 * A diferencia de la emisión normal, aquí NO se envía nada a SUNAT: solo se
 * registra el documento en el sistema para control de ventas / contabilidad /
 * SIRE. Por eso se exigen la serie y el correlativo del documento original
 * (en la emisión normal se autogeneran) y el comprobante queda directamente
 * en estado EMITIDO.
 *
 * Solo se admiten Facturas ('01') y Boletas ('03'). Las notas de crédito/débito
 * importadas requieren manejo del documento afectado y se dejan para una fase
 * posterior.
 */
export class ImportarComprobanteDto extends CrearComprobanteDto {
  // En importación estos campos son opcionales: el tipoOperacion puede omitirse
  // (queda nulo) y la leyenda "SON: ..." la calcula el backend si no se envía.
  @IsOptional()
  @IsInt()
  tipoOperacionId: number;

  @IsOptional()
  @IsString()
  leyenda: string;

  // Serie del documento ya emitido (ej. 'F001', 'B001'). Se guarda tal cual,
  // sin pasar por el generador de correlativos.
  @IsString()
  @IsNotEmpty()
  serie: string;

  // Número correlativo del documento ya emitido.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  correlativo: number;

  // Identificador SUNAT / ticket del documento original, si se conoce. Solo
  // informativo (no se reenvía).
  @IsOptional()
  @IsString()
  documentoId?: string;

  // Si el import debe descontar inventario (Kardex SALIDA). Por defecto true.
  // Poner false cuando los productos ya salieron por otra vía y no deben
  // descontarse de nuevo.
  @IsOptional()
  @IsBoolean()
  afectarStock?: boolean;

  // Si el import debe registrar el cobro en caja. Por defecto true. Poner false
  // para registrar solo el documento (contabilidad/SIRE) sin tocar caja.
  @IsOptional()
  @IsBoolean()
  afectarCaja?: boolean;
}
