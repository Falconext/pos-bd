import { IsBoolean, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
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

  // Ubigeo SUNAT (6 dígitos): lo usa la guía de traslado entre sedes para
  // partida y llegada, junto con `codigo` (anexo SUNAT).
  @IsOptional()
  @Matches(/^(\d{6})?$/, { message: 'El ubigeo debe tener 6 dígitos' })
  ubigeo?: string;

  @IsEnum(TipoSede)
  @IsOptional()
  tipo?: TipoSede;

  @IsBoolean()
  @IsOptional()
  esPrincipal?: boolean;

  // Habilita facturación en sedes tipo ALMACEN.
  @IsBoolean()
  @IsOptional()
  permiteFacturacion?: boolean;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}
