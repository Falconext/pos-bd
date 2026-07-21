import {
  IsInt,
  IsOptional,
  IsString,
  IsNumber,
  IsDateString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

// Un vehículo dentro del contrato, con su monto anual individual.
export class VehiculoContratoItemDto {
  @IsInt()
  @Type(() => Number)
  vehiculoId: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  montoAnual?: number;
}

export class CreateContratoVehicularDto {
  // Compatibilidad: contrato de un solo vehículo (forma antigua).
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  vehiculoId?: number;

  // Contrato multi-vehículo: lista de vehículos con monto individual.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VehiculoContratoItemDto)
  vehiculos?: VehiculoContratoItemDto[];

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  productoId?: number;

  @IsDateString()
  fechaInicio: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  duracionMeses?: number; // default 12

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  montoAnual?: number;

  @IsOptional()
  @IsString()
  observaciones?: string;
}
