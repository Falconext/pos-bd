import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductoDto {
  @IsInt()
  @Type(() => Number)
  id: number;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  categoriaId?: number | null;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  marcaId?: number | null;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  unidadMedidaId?: number;

  @IsOptional()
  @IsString()
  tipoAfectacionIGV?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  valorUnitario?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  igvPorcentaje?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precioUnitario?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  stock?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  costoUnitario?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  stockMinimo?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  stockMaximo?: number;
}
