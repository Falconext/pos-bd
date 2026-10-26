import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class FiltrosDto {
  @IsOptional()
  @IsObject()
  filtros?: Record<string, unknown>;
}

export class GuardarSegmentoDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  id?: number;

  @IsString()
  @MaxLength(120)
  nombre!: string;

  @IsOptional()
  @IsObject()
  filtros?: Record<string, unknown>;
}

/** La plantilla va entera en `plantilla`; la normaliza el servicio. */
export class PlantillaDto {
  @IsObject()
  plantilla!: Record<string, unknown>;
}
