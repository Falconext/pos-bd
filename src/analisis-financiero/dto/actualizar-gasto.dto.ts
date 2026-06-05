import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CategoriaGasto } from '@prisma/client';

export class ActualizarGastoDto {
  @IsOptional()
  @IsEnum(CategoriaGasto)
  categoria?: CategoriaGasto;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  etiqueta?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(9999999.99)
  monto?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  descripcion?: string;
}
