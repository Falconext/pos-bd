import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString } from 'class-validator';

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
  @IsBoolean()
  usarPrecioLoteFefo?: boolean;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['QPSE', 'APISUNAT', 'JAMBLE'])
  billingProvider?: 'QPSE' | 'APISUNAT' | 'JAMBLE';

  @IsOptional()
  @IsString()
  billingApiBaseUrl?: string;

  @IsOptional()
  @IsString()
  billingApiToken?: string;

  @IsOptional()
  @IsString()
  billingApiUser?: string;

  @IsOptional()
  @IsString()
  billingApiPassword?: string;

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
  @IsIn(['falconext', 'krezka'])
  brand?: string;

  @IsOptional()
  @IsString()
  @IsIn(['facturacion', 'hotel'])
  producto?: string;

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
