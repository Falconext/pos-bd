import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Una línea del carrito: un producto (o su variante/presentación) o un combo. */
export class ItemDisponibilidadDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productoId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  varianteId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  comboId?: number;

  /** Código de la presentación (como en el pedido): la cantidad se multiplica por sus unidades. */
  @IsOptional()
  @IsString()
  presentacionCodigo?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  cantidad: number;
}

/**
 * POST /public/store/:slug/carrito/disponibilidad: revalida el carrito al
 * cambiar de sede (modo CLIENTE) o antes de pagar.
 */
export class DisponibilidadCarritoDto {
  /** Solo cuenta en modo CLIENTE; en SEDE y TODAS se ignora. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sedeId?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'El carrito debe tener al menos un producto' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemDisponibilidadDto)
  items: ItemDisponibilidadDto[];
}
