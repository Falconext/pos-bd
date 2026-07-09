import { IsString, IsOptional, IsInt, IsEmail, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum EstadoConductorLogistica {
  DISPONIBLE = 'DISPONIBLE',
  EN_RUTA = 'EN_RUTA',
  EN_DESCANSO = 'EN_DESCANSO',
  FUERA_TURNO = 'FUERA_TURNO',
  NO_DISPONIBLE = 'NO_DISPONIBLE',
  SUSPENDIDO = 'SUSPENDIDO',
}

export class CreateConductorDto {
  @IsString()
  nombre: string;

  @IsString()
  apellido: string;

  @IsOptional()
  @IsString()
  dni?: string;

  @IsOptional()
  @IsString()
  celular?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  nroLicencia?: string;

  @IsOptional()
  @IsString()
  tipoLicencia?: string;

  @IsOptional()
  @IsString()
  vencimientoLicencia?: string; // ISO date string

  @IsOptional()
  @IsString()
  tipoEmpleo?: string; // e.g. PLANILLA, EVENTUAL

  @IsOptional()
  @IsEnum(EstadoConductorLogistica)
  estado?: EstadoConductorLogistica;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  repartidorId?: number;
}
