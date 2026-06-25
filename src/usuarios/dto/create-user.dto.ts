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
import { Transform } from 'class-transformer';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @Transform(({ value }) => value || undefined)
  @IsString()
  @Length(8, 12)
  dni?: string;

  @IsOptional()
  @Transform(({ value }) => value || undefined)
  @IsString()
  celular?: string;

  @IsString()
  @IsNotEmpty()
  password: string;

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
  sistemaNegocio?: string;

  @IsOptional()
  @IsString()
  @IsIn(['FACTURACION', 'HOTEL'])
  sistemaProducto?: string;

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
