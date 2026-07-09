import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateZonaEntregaLogisticaDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  codigo?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  poligonoGeoJSON?: any;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  costoBase?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  costoPorKm?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  dificultad?: number;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
