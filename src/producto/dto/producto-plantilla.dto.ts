
import { IsString, IsOptional, IsNumber, IsInt, IsNotEmpty } from 'class-validator';

export class CreatePlantillaDto {
    @IsString()
    @IsNotEmpty()
    nombre: string;

    @IsString()
    @IsOptional()
    descripcion?: string;

    @IsString()
    @IsOptional()
    imagenUrl?: string;

    @IsNumber()
    @IsOptional()
    precioSugerido?: number;

    @IsInt()
    @IsNotEmpty()
    rubroId: number;

    @IsString()
    @IsOptional()
    unidadConteo?: string;

    @IsString()
    @IsOptional()
    categoria?: string;
}

export class UpdatePlantillaDto extends CreatePlantillaDto { }
