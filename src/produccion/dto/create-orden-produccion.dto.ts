import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrdenComponenteManualDto {
  @IsNumber()
  @Type(() => Number)
  productoInsumoId: number;

  @IsNumber()
  @Type(() => Number)
  cantidadTeorica: number;

  @IsString()
  unidad: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  costoUnitario?: number;

  @IsOptional()
  @IsString()
  observacion?: string;
}

export class CreateOrdenProduccionDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  recetaId?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  productoFinalId?: number;

  @IsString()
  loteProduccion: string;

  @IsNumber()
  @Type(() => Number)
  cantidadObjetivo: number;

  @IsOptional()
  @IsDateString()
  fechaProgramada?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  usuarioResponsableId?: number;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrdenComponenteManualDto)
  componentes?: OrdenComponenteManualDto[];
}
