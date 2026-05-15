import {
  IsArray,
  IsEmail,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsEmail()
  email: string;

  @IsString()
  @Length(8, 12)
  dni: string;

  @IsString()
  @IsNotEmpty()
  celular: string;

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
}
