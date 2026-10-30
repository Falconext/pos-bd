import { IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { DIAS_DEMO } from '../demo-rapida';

export class CrearDemoRapidaDto {
  @Matches(/^\d{11}$/, { message: 'El RUC debe tener 11 dígitos' })
  ruc: string;

  @IsEmail({}, { message: 'Correo inválido' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'El celular es obligatorio' })
  celular: string;

  @IsInt()
  rubroId: number;

  @IsInt()
  planId: number;

  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  nombreComercial?: string;

  @IsOptional()
  @IsIn([...DIAS_DEMO])
  dias?: number;
}

export class PasarProduccionDto {
  @IsInt()
  planId: number;

  @IsBoolean()
  confirmar: boolean;

  @IsOptional()
  @IsBoolean()
  borrarPruebas?: boolean;
}
