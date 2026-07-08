import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateVehiculoDto {
    @IsString()
    placa: string;

    @IsString()
    marca: string;

    @IsOptional()
    @IsString()
    modelo?: string;

    @IsOptional()
    @IsString()
    color?: string;

    @IsOptional()
    @IsInt()
    @Min(1900)
    @Max(2100)
    @Type(() => Number)
    anio?: number;

    @IsOptional()
    @IsInt()
    @Type(() => Number)
    clienteId?: number;

    @IsOptional()
    @IsInt()
    @Type(() => Number)
    sedeId?: number;

    @IsOptional()
    @IsString()
    observaciones?: string;
}
