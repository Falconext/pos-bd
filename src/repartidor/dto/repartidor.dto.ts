import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum TipoRepartidorDto {
  PLANILLA = 'PLANILLA',
  EVENTUAL = 'EVENTUAL',
}

export class CreateRepartidorDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsOptional()
  @IsString()
  celular?: string;

  @IsOptional()
  @IsEnum(TipoRepartidorDto)
  tipo?: TipoRepartidorDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sedeId?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class UpdateRepartidorDto extends CreateRepartidorDto {}
