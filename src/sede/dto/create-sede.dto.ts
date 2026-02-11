import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateSedeDto {
    @IsString()
    nombre: string;

    @IsString()
    @IsOptional()
    direccion?: string;

    @IsString()
    @IsOptional()
    codigo?: string;

    @IsBoolean()
    @IsOptional()
    esPrincipal?: boolean;
}
