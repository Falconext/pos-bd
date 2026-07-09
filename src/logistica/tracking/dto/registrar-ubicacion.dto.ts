import { IsNumber, IsOptional, IsString, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class RegistrarUbicacionDto {
  @IsInt()
  @Type(() => Number)
  conductorId: number;

  @IsNumber()
  @Type(() => Number)
  lat: number;

  @IsNumber()
  @Type(() => Number)
  lng: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  velocidad?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  bateria?: number;

  @IsOptional()
  @IsString()
  proveedor?: string;
}
