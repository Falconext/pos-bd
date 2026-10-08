import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePlanDto {
  @IsString()
  nombre: string;

  @IsString()
  @IsOptional()
  @IsIn(['facturacion', 'hotel', 'restaurante', 'logistica', 'ventas', 'full'])
  producto?:
    | 'facturacion'
    | 'hotel'
    | 'restaurante'
    | 'logistica'
    | 'ventas'
    | 'full';

  @IsString()
  @IsOptional()
  @IsIn(['falconext', 'krezka'])
  plataforma?: 'falconext' | 'krezka';

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsNumber()
  @Min(0)
  costo: number;

  @IsNumber()
  @Min(1)
  duracionDias: number;

  @IsString()
  @IsOptional()
  tipoFacturacion?: string;

  // Límites
  @IsNumber()
  @IsOptional()
  limiteUsuarios?: number;

  @IsNumber()
  @IsOptional()
  maxSedes?: number;

  @IsNumber()
  @IsOptional()
  maxImagenesProducto?: number;

  @IsNumber()
  @IsOptional()
  maxBanners?: number;

  @IsNumber()
  @IsOptional()
  maxComprobantes?: number;

  // Tope mensual de conversaciones que atiende la IA de Ventas (módulo `leads`).
  // null / sin valor = ilimitado. Al superarlo el lead se sigue capturando pero
  // la IA deja de responder (soft-block).
  @IsNumber()
  @IsOptional()
  maxLeadsMes?: number | null;

  // Features
  @IsBoolean()
  @IsOptional()
  esPrueba?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneTienda?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneBanners?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneGaleria?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneCulqi?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneDeliveryGPS?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneTicketera?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneGestionLotes?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneGestionProvisiones?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneDescripcionRica?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneAnalisisFinancieroAvanzado?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneMultiplesSedes?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneAutoGenerarImagen?: boolean;

  @IsBoolean()
  @IsOptional()
  tieneLocalizacion?: boolean;

  @IsObject()
  @IsOptional()
  features?: Record<string, boolean>;

  // Módulos asignados
  @IsOptional()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  moduloIds?: number[];

  // Submódulos asignados al plan
  @IsOptional()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  subModuloIds?: number[];
}
