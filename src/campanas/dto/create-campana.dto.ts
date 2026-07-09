import {
  IsString,
  IsEnum,
  IsOptional,
  IsNumber,
  IsDateString,
  Min,
  IsBoolean,
} from 'class-validator';
import { PlataformaAds, FrecuenciaPresupuesto } from '@prisma/client';

export class CreateCampanaDto {
  @IsString()
  nombre: string;

  @IsEnum(PlataformaAds)
  plataforma: PlataformaAds;

  @IsOptional()
  @IsNumber()
  productoId?: number | null;

  @IsNumber()
  @Min(0.01)
  presupuestoDiario: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  presupuestoOriginal?: number;

  @IsOptional()
  @IsEnum(FrecuenciaPresupuesto)
  tipoPresupuesto?: FrecuenciaPresupuesto;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsOptional()
  @IsBoolean()
  esRecurrente?: boolean;

  @IsOptional()
  @IsString()
  moneda?: string;

  @IsDateString()
  fechaInicio: string;
}
