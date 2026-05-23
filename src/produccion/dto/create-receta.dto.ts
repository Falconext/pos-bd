import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RecetaComponenteDto {
  @IsNumber()
  @Type(() => Number)
  productoInsumoId: number;

  @IsNumber()
  @Type(() => Number)
  cantidadBase: number;

  @IsString()
  unidadBase: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  mermaEsperadaPorcentaje?: number;

  @IsOptional()
  @IsBoolean()
  esOpcional?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  orden?: number;
}

export class CreateRecetaDto {
  @IsNumber()
  @Type(() => Number)
  productoFinalId: number;

  @IsString()
  codigo: string;

  @IsString()
  nombre: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  version?: number;

  @IsNumber()
  @Type(() => Number)
  rendimientoObjetivo: number;

  @IsString()
  unidadRendimiento: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  mermaObjetivoPorcentaje?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecetaComponenteDto)
  componentes: RecetaComponenteDto[];
}
