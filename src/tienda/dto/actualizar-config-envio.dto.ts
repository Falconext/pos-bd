import {
  IsBoolean,
  IsDecimal,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ActualizarConfigEnvioDto {
  @IsOptional()
  @IsDecimal()
  @Type(() => Number)
  costoEnvioFijo?: number;

  @IsOptional()
  @IsBoolean()
  aceptaRecojo?: boolean;

  @IsOptional()
  @IsBoolean()
  aceptaEnvio?: boolean;

  @IsOptional()
  @IsString()
  direccionRecojo?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  tiempoPreparacionMin?: number;

  @IsOptional()
  @IsDecimal()
  @Type(() => Number)
  envioGratisDesdeSoles?: number;

  @IsOptional()
  @IsDecimal()
  @Type(() => Number)
  minimoCompra?: number;
}
