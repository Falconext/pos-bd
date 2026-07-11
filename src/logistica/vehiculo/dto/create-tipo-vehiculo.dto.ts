import { IsString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/** Tipo de vehículo de la flota (Moto, Van, Camión…). Dato maestro del empresario. */
export class CreateTipoVehiculoDto {
  @IsString()
  nombre: string;

  @IsNumber()
  @Type(() => Number)
  capacidadPesoKg: number;

  @IsNumber()
  @Type(() => Number)
  capacidadVolumenM3: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  costoPromedioKm?: number;
}
