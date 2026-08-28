import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  IsNumber,
} from 'class-validator';

export class UpdateUserDto {
  @IsInt()
  id: number;

  @IsString()
  @IsOptional()
  nombre?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @Length(8, 12)
  dni?: string;

  @IsString()
  @IsOptional()
  celular?: string;

  // Nueva contraseña (opcional). Si viene vacía o ausente, no se cambia.
  @IsString()
  @IsOptional()
  @Length(6, 72)
  password?: string;

  @IsInt()
  @IsOptional()
  empresaId?: number;

  @IsOptional()
  permisos?: string[];

  @IsArray()
  @IsOptional()
  sedeIds?: number[];

  // Sede que se usa como activa al loguear, entre las de sedeIds — evita el
  // selector de sede aunque el usuario tenga varias asignadas.
  @IsInt()
  @IsOptional()
  sedeDefaultId?: number;

  @IsArray()
  @IsOptional()
  subModuloIds?: number[];

  @IsBoolean()
  @IsOptional()
  bloquearEdicionPrecioVenta?: boolean;

  @IsBoolean()
  @IsOptional()
  ocultarPrecioCosto?: boolean;

  @IsBoolean()
  @IsOptional()
  ocultarPedidosEcommerce?: boolean;

  @IsBoolean()
  @IsOptional()
  convertirEnSupervisor?: boolean;

  @IsBoolean()
  @IsOptional()
  noPermitirVentaProductosGratuitos?: boolean;

  @IsBoolean()
  @IsOptional()
  restringirTransferenciasASuSede?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['FALCONEXT', 'KREZKA'])
  sistemaNegocio?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(['FACTURACION', 'HOTEL'])
  sistemaProducto?: string | null;

  @IsOptional()
  @IsNumber()
  comisionGlobal?: number;

  @IsOptional()
  @IsNumber()
  comisionGlobalFija?: number;

  @IsOptional()
  @IsNumber()
  comisionGlobalVenta?: number;
}
