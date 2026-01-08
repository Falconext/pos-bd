import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListComprobanteDto {
  @IsOptional()
  @IsIn(['FORMAL', 'INFORMAL', 'COTIZACION', 'TODOS'])
  tipoComprobante?: 'FORMAL' | 'INFORMAL' | 'COTIZACION' | 'TODOS';

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
  sort?: string = 'fechaEmision';

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @Type(() => String)
  @IsString()
  fechaInicio?: string;

  @IsOptional()
  @Type(() => String)
  @IsString()
  fechaFin?: string;

  @IsOptional()
  @Type(() => String)
  @IsString()
  estado?: string;

  @IsOptional()
  @Type(() => String)
  @IsString()
  estadoPago?: string;

  @IsOptional()
  @Type(() => String)
  @IsString()
  tipoDoc?: string;
}
