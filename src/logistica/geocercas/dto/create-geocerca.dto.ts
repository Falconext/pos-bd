import { IsString, IsOptional, IsEnum, IsNumber, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export enum TipoGeocercaLogistica {
  CIRCULO = 'CIRCULO',
  POLIGONO = 'POLIGONO',
}

export class CreateGeocercaDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsEnum(TipoGeocercaLogistica)
  tipo?: TipoGeocercaLogistica;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  radio?: number; // metros

  @IsOptional()
  @IsString()
  coordenadas?: string; // GeoJSON serializado (polígono)

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
