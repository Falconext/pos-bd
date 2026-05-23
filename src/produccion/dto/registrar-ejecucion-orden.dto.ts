import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ComponenteEjecutadoDto {
  @IsNumber()
  @Type(() => Number)
  productoInsumoId: number;

  @IsNumber()
  @Type(() => Number)
  cantidadConsumida: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  mermaCantidad?: number;

  @IsOptional()
  @IsString()
  observacion?: string;
}

export class RegistrarEjecucionOrdenDto {
  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsNumber()
  @Type(() => Number)
  cantidadProducida: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  mermaTotal?: number;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComponenteEjecutadoDto)
  componentes: ComponenteEjecutadoDto[];
}
