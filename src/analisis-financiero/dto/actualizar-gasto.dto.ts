import {
  IsBoolean,
  IsEnum,
  IsISO8601,
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
  @IsISO8601()
  fecha?: string;

  @IsOptional()
  @IsBoolean()
  recurrenteDiario?: boolean;

  @IsOptional()
  @IsISO8601()
  fechaInicio?: string;

  @IsOptional()
  @IsISO8601()
  fechaFin?: string;

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
