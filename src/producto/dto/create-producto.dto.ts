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

  @IsOptional()
  @IsString()
  imagenUrl?: string;

  // 🆕 FARMACIA/BOTICA
  @IsOptional()
  @IsString()
  principioActivo?: string;

  @IsOptional()
  @IsString()
  laboratorio?: string;

  @IsOptional()
  @IsString()
  concentracion?: string;

  @IsOptional()
  @IsString()
  presentacion?: string;

  // 🆕 BODEGA/SUPERMARKET
  @IsOptional()
  @IsString()
  codigoBarras?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  pesoGramos?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  volumenMl?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precioOferta?: number;

  // 🆕 FRACCIONAMIENTO
  @IsOptional()
  @IsString()
  unidadCompra?: string;

  @IsOptional()
  @IsString()
  unidadVenta?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  factorConversion?: number;

  @IsOptional()
  preciosMayorista?: { cantidadMinima: number; precio: number }[];
}
