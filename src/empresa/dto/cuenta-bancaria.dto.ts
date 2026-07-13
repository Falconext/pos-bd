import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

const BANCOS_VALIDOS = [
  'BCP',
  'INTERBANK',
  'BBVA',
  'SCOTIABANK',
  'PICHINCHA',
  'BANBIF',
  'NACION',
  'OTROS',
];
const TIPOS_CUENTA = ['AHORROS', 'CORRIENTE'];
const MONEDAS = ['PEN', 'USD'];

export class CreateCuentaBancariaDto {
  @IsString()
  @IsIn(BANCOS_VALIDOS)
  banco: string;

  @IsString()
  @MinLength(1)
  numeroCuenta: string;

  @IsOptional()
  @IsString()
  cci?: string;

  @IsOptional()
  @IsString()
  titular?: string;

  @IsOptional()
  @IsString()
  @IsIn(TIPOS_CUENTA)
  tipoCuenta?: string;

  @IsOptional()
  @IsString()
  @IsIn(MONEDAS)
  moneda?: string;

  @IsOptional()
  @IsString()
  alias?: string;

  @IsOptional()
  @IsBoolean()
  mostrarEnCotizacion?: boolean;
}

export class UpdateCuentaBancariaDto {
  @IsOptional()
  @IsString()
  @IsIn(BANCOS_VALIDOS)
  banco?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  numeroCuenta?: string;

  @IsOptional()
  @IsString()
  cci?: string;

  @IsOptional()
  @IsString()
  titular?: string;

  @IsOptional()
  @IsString()
  @IsIn(TIPOS_CUENTA)
  tipoCuenta?: string;

  @IsOptional()
  @IsString()
  @IsIn(MONEDAS)
  moneda?: string;

  @IsOptional()
  @IsString()
  alias?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsBoolean()
  mostrarEnCotizacion?: boolean;
}
