import {
  IsArray,
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

  @IsInt()
  @IsOptional()
  empresaId?: number;

  @IsOptional()
  permisos?: string[];

  @IsArray()
  @IsOptional()
  sedeIds?: number[];

  @IsArray()
  @IsOptional()
  subModuloIds?: number[];

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
