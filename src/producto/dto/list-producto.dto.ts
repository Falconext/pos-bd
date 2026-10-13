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
}
