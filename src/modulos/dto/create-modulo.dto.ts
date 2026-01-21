import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateModuloDto {
    @IsString()
    codigo: string;

    @IsString()
    nombre: string;

    @IsString()
    @IsOptional()
    descripcion?: string;

    @IsString()
    @IsOptional()
    icono?: string;

    @IsInt()
    @IsOptional()
    orden?: number;

    @IsBoolean()
    @IsOptional()
    activo?: boolean;
}
