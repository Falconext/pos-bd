import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListEmpresaDto {
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
  @IsIn(['id', 'ruc', 'razonSocial', 'fechaActivacion', 'fechaExpiracion'])
  sort?: 'id' | 'ruc' | 'razonSocial' | 'fechaActivacion' | 'fechaExpiracion' =
    'id';

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  @IsIn(['facturacion', 'hotel', 'logistica'])
  producto?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ACTIVO', 'INACTIVO', 'TODOS'])
  estado?: 'ACTIVO' | 'INACTIVO' | 'TODOS';

  @IsOptional()
  @IsString()
  @IsIn(['FORMAL', 'INFORMAL', ''])
  tipoEmpresa?: 'FORMAL' | 'INFORMAL' | '';

  // Solo para exportación del listado
  @IsOptional()
  @IsString()
  @IsIn(['pdf', 'excel'])
  formato?: 'pdf' | 'excel';
}
