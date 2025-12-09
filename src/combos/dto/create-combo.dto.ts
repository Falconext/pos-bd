import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, IsArray, ValidateNested, IsBoolean, IsDateString, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class ComboItemDto {
    @IsInt()
    productoId: number;

    @IsInt()
    @Min(1)
    cantidad: number;
}

export class CreateComboDto {
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
    @Min(0)
    precioCombo: number;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ComboItemDto)
    items: ComboItemDto[];

    @IsBoolean()
    @IsOptional()
    activo?: boolean;

    @IsDateString()
    @IsOptional()
    fechaInicio?: string;

    @IsDateString()
    @IsOptional()
    fechaFin?: string;
}
