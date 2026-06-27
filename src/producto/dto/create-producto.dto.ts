import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateProductoDto {
  @IsOptional()
  @IsBoolean()
  publicarEnTienda?: boolean;

  @IsOptional()
  @IsString()
  codigo?: string;

  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  unidadMedidaId?: number;

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
  @IsBoolean()
  visibleEnSede?: boolean;

  @IsOptional()
  @IsBoolean()
  vendibleEnSede?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precioUnitarioSede?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  precioOfertaSede?: number;

  @IsOptional()
  @IsString()
  ubicacionSede?: string;

  @IsOptional()
  @IsString()
  imagenUrl?: string;

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

  @IsOptional()
  @IsBoolean()
  requiereReceta?: boolean;

  @IsOptional()
  @IsBoolean()
  controlado?: boolean;

  @IsOptional()
  @IsBoolean()
  refrigerado?: boolean;

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

  @IsOptional()
  @IsString()
  fechaInicioOferta?: string | Date;

  @IsOptional()
  @IsString()
  fechaFinOferta?: string | Date;

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

  @IsOptional()
  @IsString()
  descripcionLarga?: string;

  @IsOptional()
  atributosTecnicos?: Record<string, any>;

  // 🆕 VARIANTES (Shopify style)
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  productoPadreId?: number;

  @IsOptional()
  opcionesAtributos?: any; // e.g. [{"nombre": "Color", "valores": ["Rojo"]}]

  @IsOptional()
  valoresAtributos?: any; // e.g. {"Color": "Rojo", "Talla": "M"}

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
