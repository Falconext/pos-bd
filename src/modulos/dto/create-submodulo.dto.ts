import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateSubModuloDto {
  @IsInt()
  moduloId: number;

  @IsString()
  @IsNotEmpty()
  codigo: string;

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsOptional()
  ruta?: string;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  orden?: number;
}
