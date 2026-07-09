import {
  IsNotEmpty,
  IsString,
  IsInt,
  IsOptional,
  IsDateString,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CrearLoteDto {
  @IsNotEmpty()
  @IsInt()
  @Type(() => Number)
  productoId: number;

  @IsNotEmpty()
  @IsString()
  lote: string;

  @IsNotEmpty()
  @IsDateString()
  fechaVencimiento: string;

  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Type(() => Number)
  stockInicial: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  costoUnitario?: number;

  @IsOptional()
  @IsString()
  proveedor?: string;
}

export class DescontarStockLoteDto {
  @IsNotEmpty()
  @IsInt()
  @Type(() => Number)
  productoId: number;

  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Type(() => Number)
  cantidad: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  loteId?: number; // Opcional: si no se proporciona, usa FEFO automático
}
