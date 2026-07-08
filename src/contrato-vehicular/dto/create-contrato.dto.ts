import { IsInt, IsOptional, IsString, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateContratoVehicularDto {
    @IsInt()
    @Type(() => Number)
    vehiculoId: number;

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
