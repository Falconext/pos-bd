import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
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

  /**
   * Sede a la que se carga el gasto. Omitir (o null) = gasto de TODA la
   * empresa: no se le carga a ninguna sede y solo suma en el consolidado.
   */
  @IsOptional()
  @IsInt()
  sedeId?: number | null;

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
  @IsIn(['PEN', 'USD'])
  moneda?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Max(999999.9999)
  tipoCambio?: number;

  @IsOptional()
  @IsInt()
  cuentaBancariaId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  medioPago?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  proveedor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  numeroDocumento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  numeroOperacion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  descripcion?: string;
}
