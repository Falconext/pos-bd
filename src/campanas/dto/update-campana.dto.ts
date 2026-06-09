import { IsString, IsEnum, IsOptional, IsNumber, IsDateString, Min } from 'class-validator';
import { PlataformaAds, EstadoCampana } from '@prisma/client';

export class UpdateCampanaDto {
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
  @IsString()
  moneda?: string;

  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsEnum(EstadoCampana)
  estado?: EstadoCampana;
}
