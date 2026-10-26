import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
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

export class CrearEnvioDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  segmentoId?: number;

  @IsOptional()
  @IsObject()
  filtros?: Record<string, unknown>;

  @IsInt()
  @Min(1)
  plantillaId!: number;

  @IsOptional()
  @IsObject()
  valores?: { dato1?: string; dato2?: string };

  @IsOptional()
  @IsString()
  programadoPara?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  porMinuto?: number;
}

export class ProbarEnvioDto {
  @IsInt()
  @Min(1)
  plantillaId!: number;

  @IsOptional()
  @IsObject()
  valores?: { dato1?: string; dato2?: string };
}
