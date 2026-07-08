import { IsString, IsOptional, IsInt, IsIn, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ChecklistItemDto {
    @IsString()
    categoria: string;

    @IsString()
    item: string;

    @IsString()
    estado: string;

    @IsOptional()
    @IsString()
    nota?: string;
}

export class CreateActaDto {
    @IsString()
    @IsIn(['INGRESO', 'RETIRO'])
    tipo: 'INGRESO' | 'RETIRO';

    @IsOptional()
    @IsInt()
    @Type(() => Number)
    km?: number;

    @IsOptional()
    @IsString()
    @IsIn(['LLENO', '3/4', '1/2', '1/4', 'VACIO'])
    nivelCombustible?: string;

    @IsOptional()
    @IsString()
    observaciones?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    fotos?: string[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ChecklistItemDto)
    checklist?: ChecklistItemDto[];
}
