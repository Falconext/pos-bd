import { IsString, IsEnum, IsOptional, IsNumber, IsDateString, Min } from 'class-validator';
import { PlataformaAds } from '@prisma/client';

export class CreateCampanaDto {
  @IsString()
  nombre: string;

  @IsEnum(PlataformaAds)
  plataforma: PlataformaAds;

  @IsOptional()
  @IsNumber()
  productoId?: number;

  @IsNumber()
  @Min(0.01)
  presupuestoDiario: number;

  @IsOptional()
  @IsString()
  moneda?: string;

  @IsDateString()
  fechaInicio: string;
}
