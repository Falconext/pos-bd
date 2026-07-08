import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { TipoSede } from '@prisma/client';

export class CreateSedeDto {
    @IsString()
    nombre: string;

    @IsString()
    @IsOptional()
    direccion?: string;

    @IsString()
    @IsOptional()
    codigo?: string;

    @IsEnum(TipoSede)
    @IsOptional()
    tipo?: TipoSede;

    @IsBoolean()
    @IsOptional()
    esPrincipal?: boolean;

    @IsBoolean()
    @IsOptional()
    activo?: boolean;
}
