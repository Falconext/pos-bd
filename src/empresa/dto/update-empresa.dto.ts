import { IsBoolean, IsDateString, IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateEmpresaDto {
  @IsInt()
  id: number;

  @IsOptional()
  @IsString()
  ruc?: string;

  @IsOptional()
  @IsString()
  razonSocial?: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsInt()
  planId?: number;

  @IsOptional()
  @IsString()
  tipoEmpresa?: 'FORMAL' | 'INFORMAL';

  @IsOptional()
  @IsString()
  departamento?: string;

  @IsOptional()
  @IsString()
  provincia?: string;

  @IsOptional()
  @IsString()
  distrito?: string;

  @IsOptional()
  @IsString()
  ubigeo?: string;

  @IsOptional()
  @IsInt()
  rubroId?: number;

  @IsOptional()
  @IsString()
  nombreComercial?: string;

  @IsOptional()
  @IsString()
  fechaActivacion?: string;

  @IsOptional()
  @IsString()
  fechaExpiracion?: string;

  @IsOptional()
  @IsString()
  providerToken?: string;

  @IsOptional()
  @IsBoolean()
  esAgenteRetencion?: boolean;

  @IsOptional()
  @IsBoolean()
  usaCodigoBarrasManual?: boolean;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  bancoNombre?: string;

  @IsOptional()
  @IsString()
  numeroCuenta?: string;

  @IsOptional()
  @IsString()
  cci?: string;

  @IsOptional()
  @IsString()
  monedaCuenta?: string;

  @IsOptional()
  @IsString()
  yapeNumero?: string;

  @IsOptional()
  @IsString()
  yapeQrUrl?: string;

  @IsOptional()
  @IsString()
  plinNumero?: string;

  @IsOptional()
  @IsString()
  plinQrUrl?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  usuarioPse?: string;

  @IsOptional()
  @IsString()
  contrasenaPse?: string;

  @IsOptional()
  @IsBoolean()
  usaDemo?: boolean;

  @IsOptional()
  usuario?: UpdateEmpresaUsuarioDto;
}

export class UpdateEmpresaUsuarioDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  dni?: string;

  @IsOptional()
  @IsString()
  celular?: string;
}
