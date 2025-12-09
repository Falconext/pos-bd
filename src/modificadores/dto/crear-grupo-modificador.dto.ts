import { IsString, IsOptional, IsBoolean, IsInt, Min, Max, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CrearOpcionDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @Type(() => Number)
  precioExtra?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsBoolean()
  esDefault?: boolean;
}

export class CrearGrupoModificadorDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsBoolean()
  esObligatorio?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  seleccionMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  seleccionMax?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrearOpcionDto)
  opciones?: CrearOpcionDto[];
}
