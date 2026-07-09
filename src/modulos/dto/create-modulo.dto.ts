import { IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateModuloDto {
  @IsString()
  codigo: string;

  @IsString()
  @IsOptional()
  @IsIn(['facturacion', 'hotel'])
  producto?: 'facturacion' | 'hotel';

  @IsString()
  nombre: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsOptional()
  icono?: string;

  @IsString()
  @IsOptional()
  ruta?: string;

  @IsInt()
  @IsOptional()
  orden?: number;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}
