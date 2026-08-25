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
import { Transform, Type } from 'class-transformer';

// Regla de precio por volumen (mayorista). Se declara como clase para que
// class-transformer sepa instanciar cada elemento del array; sin esto y con
// enableImplicitConversion activo, los objetos se convertían a [] al crear.
export class PrecioMayoristaDto {
  @Type(() => Number)
  @IsNumber()
  cantidadMinima: number;

  @Type(() => Number)
  @IsNumber()
  precio: number;
}

// Código de barra ADICIONAL de un producto. `unidadesPorPaquete > 1` significa
// que ese código es un PAQUETE (ej. six-pack) del mismo producto: comparte el
// mismo stock, pero escanearlo vende/descuenta N unidades en vez de 1.
export class CodigoBarraExtraDto {
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unidadesPorPaquete?: number;

  // Precio TOTAL del paquete (opcional): si se define, escanear este código
  // cobra ese total en vez de precioUnitario × unidades.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  precioPaquete?: number;

  // Nombre propio del paquete (ej. "SIX PACK CERVEZA PILSEN").
  @IsOptional()
  @IsString()
  alias?: string;

  // Imagen del paquete: URL S3 existente o data-URI base64 (se sube a S3).
  @IsOptional()
  @IsString()
  imagenUrl?: string;
}

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

  @IsOptional()
  @IsString()
  moneda?: string; // 'PEN' (soles) o 'USD' (dólares). Default PEN.

  @IsNumber()
  @Type(() => Number)
  precioUnitario: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  igvPorcentaje?: number; // default 18

  @IsNumber({ maxDecimalPlaces: 3 })
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

  // 🆕 Códigos de barra ADICIONALES (mismo producto, distinto EAN por lote/importación,
  // o un código de PAQUETE con unidadesPorPaquete > 1 — ej. six-pack)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CodigoBarraExtraDto)
  codigosBarrasExtra?: CodigoBarraExtraDto[];

  // Código de producto SUNAT (Catálogo 25 / UNSPSC) — requerido para detracción
  @IsOptional()
  @IsString()
  codProdSunat?: string;

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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrecioMayoristaDto)
  preciosMayorista?: PrecioMayoristaDto[];

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
