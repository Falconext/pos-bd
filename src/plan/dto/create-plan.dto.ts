import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePlanDto {
    @IsString()
    nombre: string;

    @IsString()
    @IsOptional()
    descripcion?: string;

    @IsNumber()
    @Min(0)
    costo: number;

    @IsNumber()
    @Min(1)
    duracionDias: number;

    // Límites
    @IsNumber()
    @IsOptional()
    limiteUsuarios?: number;

    @IsNumber()
    @IsOptional()
    maxImagenesProducto?: number;

    @IsNumber()
    @IsOptional()
    maxBanners?: number;

    @IsNumber()
    @IsOptional()
    maxComprobantes?: number;

    // Features
    @IsBoolean()
    @IsOptional()
    esPrueba?: boolean;

    @IsBoolean()
    @IsOptional()
    tieneTienda?: boolean;

    @IsBoolean()
    @IsOptional()
    tieneBanners?: boolean;

    @IsBoolean()
    @IsOptional()
    tieneGaleria?: boolean;

    @IsBoolean()
    @IsOptional()
    tieneCulqi?: boolean;

    @IsBoolean()
    @IsOptional()
    tieneDeliveryGPS?: boolean;

    @IsBoolean()
    @IsOptional()
    tieneTicketera?: boolean;

    // Módulos asignados
    @IsOptional()
    @IsNumber({}, { each: true })
    @Type(() => Number)
    moduloIds?: number[];
}
