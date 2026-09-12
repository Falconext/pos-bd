import {
  IsOptional,
  IsDateString,
  IsInt,
  IsEnum,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum TipoMovimiento {
  INGRESO = 'INGRESO',
  SALIDA = 'SALIDA',
  AJUSTE = 'AJUSTE',
  TRANSFERENCIA = 'TRANSFERENCIA',
}

export class FiltrosKardexDto {
  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productoId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoriaId?: number;

  @IsOptional()
  @IsEnum(TipoMovimiento)
  tipoMovimiento?: TipoMovimiento;

  @IsOptional()
  @IsString()
  concepto?: string;

  // Sede a consultar. Solo la respeta el admin/supervisor; el usuario de sede
  // fija siempre ve la suya (lo fuerza el controller).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sedeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}

export class FiltrosReporteDto {
  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoriaId?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  incluirInactivos?: boolean = false;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  soloStockCritico?: boolean = false;
}
