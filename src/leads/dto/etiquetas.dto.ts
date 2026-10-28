import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { COLORES_ETIQUETA } from '../leads-etiquetas';

export class CrearEtiquetaDto {
  @IsString()
  @MaxLength(80)
  nombre!: string;

  @IsOptional()
  @IsIn(COLORES_ETIQUETA, { message: 'Ese color no está en la paleta.' })
  color?: string;
}

export class EditarEtiquetaDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nombre?: string;

  @IsOptional()
  @IsIn(COLORES_ETIQUETA, { message: 'Ese color no está en la paleta.' })
  color?: string;
}

/** Una etiqueta existente (`etiquetaId`) o una por nombre, que se crea si falta. */
export class PonerEtiquetaDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  etiquetaId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nombre?: string;

  @IsOptional()
  @IsIn(COLORES_ETIQUETA, { message: 'Ese color no está en la paleta.' })
  color?: string;
}
