import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CategoriaGasto } from '@prisma/client';

export class CrearGastoDto {
  @IsInt()
  @Min(1)
  @Max(12)
  mes: number;

  @IsInt()
  @Min(2020)
  @Max(2100)
  anio: number;

  @IsEnum(CategoriaGasto)
  categoria: CategoriaGasto;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  etiqueta?: string;

  @IsNumber()
  @Min(0.01)
  @Max(9999999.99)
  monto: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  descripcion?: string;
}
