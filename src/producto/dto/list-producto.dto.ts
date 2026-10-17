import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ListProductoDto {
  @IsOptional()
  @Type(() => String)
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @IsIn(['id', 'descripcion', 'codigo'])
  sort?: 'id' | 'descripcion' | 'codigo' = 'id';

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  marcaId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoriaId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sedeId?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  soloVendibles?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  usarPrecioSede?: boolean;

  // Lista de precios elegida a mano en el POS. Pisa la resolución automática
  // por usuario/sede: el cajero decide si cobra "para llevar" o "para la mesa".
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  listaPrecioId?: number;

  // Cliente de la venta: su lista pactada gana sobre la del vendedor.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  clienteId?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  soloStockBajo?: boolean;

  // Prioriza en el listado los productos con stock (los muestra primero). Usado
  // por el POS de facturación para que lo vendible aparezca arriba.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  priorizarStock?: boolean;

  // Incluye los productos NO disponibles en la sede consultada (para asignarlos).
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  incluirOcultos?: boolean;

  // Incluye las variantes (tallas, colores), que son productos hijos y por
  // defecto el catálogo esconde para no repetir el modelo en cada fila. Lo pide
  // el filtro del kardex, donde hay que poder elegir una talla concreta.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  incluirVariantes?: boolean;

  // Ids concretos a traer ("12,45,78"), sin importar la paginación ni el filtro.
  // Lo pide el POS para hidratar las líneas de un comprobante que se edita: sus
  // productos casi nunca caen en la página del catálogo que está cargada, y sin
  // esto la línea se queda sin sus presentaciones.
  @IsOptional()
  @Transform(({ value }) =>
    String(value ?? '')
      .split(',')
      .map((v) => Number(String(v).trim()))
      .filter((v) => Number.isFinite(v) && v > 0),
  )
  ids?: number[];
}
