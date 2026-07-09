import {
  IsString,
  IsEnum,
  IsOptional,
  IsNumber,
  IsDateString,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateCampanaDto } from './create-campana.dto';
import {
  PlataformaAds,
  EstadoCampana,
  FrecuenciaPresupuesto,
} from '@prisma/client';
import { IsBoolean } from 'class-validator';

export class UpdateCampanaDto extends PartialType(CreateCampanaDto) {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsEnum(PlataformaAds)
  plataforma?: PlataformaAds;

  @IsOptional()
  @IsNumber()
  productoId?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  presupuestoDiario?: number;

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

  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsEnum(EstadoCampana)
  estado?: EstadoCampana;
}
