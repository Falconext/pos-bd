import { IsString, IsOptional, IsNumber, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

/** Prueba de entrega que registra el repartidor/empresario al confirmar la entrega. */
export class RegistrarEntregaDto {
  @IsOptional()
  @IsString()
  nombreReceptor?: string;

  @IsOptional()
  @IsString()
  dniReceptor?: string;

  @IsOptional()
  @IsString()
  parentesco?: string;

  @IsOptional()
  @IsString()
  firmaUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fotosUrls?: string[];

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  montoCobrado?: number;

  @IsOptional()
  @IsString()
  metodoPago?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lng?: number;

  @IsOptional()
  @IsString()
  notas?: string;
}
