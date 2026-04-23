import {
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
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
}
