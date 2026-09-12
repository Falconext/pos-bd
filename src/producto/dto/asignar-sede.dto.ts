import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Asignar/quitar varios productos de una sede (Inventario → Asignar a sede). */
export class AsignarSedeMasivoDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sedeId: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Type(() => Number)
  productoIds: number[];

  /** true = disponible en la sede; false = quitar de la sede. */
  @IsBoolean()
  disponible: boolean;

  /** Al quitar: dejar el stock de la sede en 0 (salida en kardex) y quitar igual. */
  @IsOptional()
  @IsBoolean()
  ajustarStockACero?: boolean;
}

/** Asignar un producto existente a una sede, con stock inicial opcional. */
export class AsignarProductoSedeDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stock?: number;
}
