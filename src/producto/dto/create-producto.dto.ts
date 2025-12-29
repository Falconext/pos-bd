import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductoDto {
  @IsOptional()
  @IsString()
  codigo?: string;

  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @IsInt()
  @Type(() => Number)
  unidadMedidaId: number;

  @IsString()
  tipoAfectacionIGV: string; // '10', '20', '30', '40'

  @IsNumber()
  @Type(() => Number)
  precioUnitario: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  igvPorcentaje?: number; // default 18

  @IsInt()
  @Type(() => Number)
  stock: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  categoriaId?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  marcaId?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  stockMinimo?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  stockMaximo?: number;
}
