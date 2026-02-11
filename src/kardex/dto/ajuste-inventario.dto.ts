import { IsNotEmpty, IsInt, IsEnum, IsString, IsOptional, IsDecimal, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export enum TipoAjuste {
  POSITIVO = 'POSITIVO',
  NEGATIVO = 'NEGATIVO',
  CORRECCION = 'CORRECCION',
}

export class AjusteInventarioDto {
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productoId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sedeId?: number;

  @IsNotEmpty()
  @IsEnum(TipoAjuste)
  tipoAjuste: TipoAjuste;

  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad: number;

  @IsOptional()
  @Type(() => Number)
  costoUnitario?: number;

  @IsNotEmpty()
  @IsString()
  motivo: string;

  @IsOptional()
  @IsString()
  observacion?: string;

  @IsOptional()
  @IsString()
  lote?: string;

  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;
}

export class AjusteMasivoDto {
  @IsNotEmpty()
  ajustes: AjusteInventarioDto[];

  @IsNotEmpty()
  @IsString()
  motivoGeneral: string;

  @IsOptional()
  @IsString()
  observacionGeneral?: string;
}