import { IsString, IsOptional, IsBoolean, IsUrl, Matches, IsInt, Min, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class ConfigurarTiendaDto {
  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'El slug solo puede contener letras minúsculas, números y guiones',
  })
  slugTienda?: string;

  @IsString()
  @IsOptional()
  descripcionTienda?: string;

  @IsString()
  @IsOptional()
  whatsappTienda?: string;

  @IsString()
  @IsOptional()
  @IsUrl()
  facebookUrl?: string;

  @IsString()
  @IsOptional()
  @IsUrl()
  instagramUrl?: string;

  @IsString()
  @IsOptional()
  @IsUrl()
  tiktokUrl?: string;

  @IsString()
  @IsOptional()
  horarioAtencion?: string;

  @IsString()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'Color primario debe ser hexadecimal' })
  colorPrimario?: string;

  @IsString()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'Color secundario debe ser hexadecimal' })
  colorSecundario?: string;

  @IsString()
  @IsOptional()
  yapeQrUrl?: string;

  @IsString()
  @IsOptional()
  yapeNumero?: string;

  @IsString()
  @IsOptional()
  plinQrUrl?: string;

  @IsString()
  @IsOptional()
  plinNumero?: string;

  @IsBoolean()
  @IsOptional()
  aceptaEfectivo?: boolean;

  // === Campos de envío/recojo (permitir guardar desde este endpoint) ===
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costoEnvioFijo?: number;

  @IsOptional()
  @IsBoolean()
  aceptaRecojo?: boolean;

  @IsOptional()
  @IsBoolean()
  aceptaEnvio?: boolean;

  @IsOptional()
  @IsString()
  direccionRecojo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  tiempoPreparacionMin?: number;
}
