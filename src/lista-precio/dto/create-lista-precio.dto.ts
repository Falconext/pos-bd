import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
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
}

export class CreateListaPrecioDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

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
  @ValidateNested({ each: true })
  @Type(() => ListaPrecioItemDto)
  items?: ListaPrecioItemDto[];
}
