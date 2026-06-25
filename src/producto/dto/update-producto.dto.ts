import { IsBoolean, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class UpdateProductoDto {
  @IsInt()
  @Type(() => Number)
  id: number;

  @IsOptional()
  @IsBoolean()
  publicarEnTienda?: boolean;

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
  @IsNumber()
  @Type(() => Number)
  costoFijo?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  comisionPorVenta?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  comisionPorcentaje?: number;

  @IsOptional()
  @IsString()
  imagenUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  removerImagen?: boolean;

  @IsOptional()
  @IsString()
  localizacion?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  porcentajeVenta?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  porcentajeProvision?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  stockMinimo?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  stockMaximo?: number;

  @IsOptional()
  @IsBoolean()
  visibleEnSede?: boolean;

  @IsOptional()
  @IsBoolean()
  vendibleEnSede?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precioUnitarioSede?: number | null;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precioOfertaSede?: number | null;

  @IsOptional()
  @IsString()
  ubicacionSede?: string | null;

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

  @IsOptional()
  @IsBoolean()
  requiereReceta?: boolean;

  @IsOptional()
  @IsBoolean()
  controlado?: boolean;

  @IsOptional()
  @IsBoolean()
  refrigerado?: boolean;

  // Campos Ofertas
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precioOferta?: number;

  @IsOptional()
  @IsString()
  fechaInicioOferta?: string | Date;

  @IsOptional()
  @IsString()
  fechaFinOferta?: string | Date;

  @IsOptional()
  preciosMayorista?: { cantidadMinima: number; precio: number }[];

  @IsOptional()
  @IsString()
  descripcionLarga?: string | null;

  @IsOptional()
  atributosTecnicos?: Record<string, any> | null;

  @IsOptional()
  opcionesAtributos?: any;

  @IsOptional()
  valoresAtributos?: any;

  @IsOptional()
  productoPadreId?: number | null;

  @IsOptional()
  variantesConfig?: {
    valoresAtributos: Record<string, string>;
    codigo?: string;
    precioUnitario?: number;
    stock?: number;
    imagenUrl?: string | null;
    codigoBarras?: string | null;
    estado?: 'ACTIVO' | 'INACTIVO';
  }[];
}
