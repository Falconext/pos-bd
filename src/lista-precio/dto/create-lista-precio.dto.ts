import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListaPrecioItemDto {
  @IsInt()
  productoId: number;

  // "" = unidad base; si no, código de la presentación (ProductoCodigoBarras)
  @IsOptional()
  @IsString()
  presentacionCodigo?: string;

  @IsNumber()
  precioUnitario: number;

  @IsOptional()
  @IsNumber()
  precioOferta?: number | null;

  // Descuento en % que esta lista aplica sobre el precio (0-100).
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  descuentoPorcentaje?: number | null;
}

export class CreateListaPrecioDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  // Desempate cuando dos listas podrían aplicar: gana la de `orden` menor.
  @IsOptional()
  @IsInt()
  orden?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsBoolean()
  esPorDefecto?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  sedeIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  usuarioIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  clienteIds?: number[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ListaPrecioItemDto)
  items?: ListaPrecioItemDto[];
}
