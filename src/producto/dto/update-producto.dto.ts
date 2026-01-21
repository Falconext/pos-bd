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

  // Campos Farmacia
  @IsOptional()
  @IsString()
  principioActivo?: string;

  @IsOptional()
  @IsString()
  concentracion?: string;

  @IsOptional()
  @IsString()
  presentacion?: string;

  @IsOptional()
  @IsString()
  laboratorio?: string;

  @IsOptional()
  @IsString()
  unidadCompra?: string;

  @IsOptional()
  @IsString()
  unidadVenta?: string;

  @IsOptional()
  // @IsNumber() // Se recibe como string/number y se convierte
  factorConversion?: number | string;

  @IsOptional()
  @IsString()
  codigoBarras?: string;

  @IsOptional()
  @IsString()
  codigoDigemid?: string;

  // Campos Ofertas
  @IsOptional()
  // @IsNumber()
  precioOferta?: number;

  @IsOptional()
  // @IsDateString() // Puede ser vacío o string fecha
  fechaInicioOferta?: string | Date;

  @IsOptional()
  // @IsDateString()
  fechaFinOferta?: string | Date;
}
