import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsUrl,
} from 'class-validator';

export class CreateGaleriaDto {
  @IsNumber()
  productoId: number;

  @IsString()
  @IsUrl()
  imagenUrl: string;

  @IsNumber()
  @IsOptional()
  orden?: number;

  @IsBoolean()
  @IsOptional()
  esPrincipal?: boolean;
}
