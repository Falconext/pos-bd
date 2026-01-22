import { IsString, IsOptional, IsBoolean, IsNumber, IsUrl } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateBannerDto {
    @IsString()
    titulo: string;

    @IsString()
    @IsOptional()
    subtitulo?: string;

    @IsString()
    @IsUrl()
    imagenUrl: string;

    @IsString()
    @IsOptional()
    linkUrl?: string;

    @IsNumber()
    @IsOptional()
    @Transform(({ value }) => value !== undefined && value !== '' ? Number(value) : undefined)
    productoId?: number;

    @IsNumber()
    @IsOptional()
    @Transform(({ value }) => value !== undefined && value !== '' ? Number(value) : undefined)
    orden?: number;

    @IsBoolean()
    @IsOptional()
    activo?: boolean;
}

