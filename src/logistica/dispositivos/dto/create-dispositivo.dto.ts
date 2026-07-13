import { IsString, IsOptional, IsInt, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDispositivoDto {
  @IsString()
  nombre: string;

  @IsString()
  identificador: string; // IMEI o serial

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vehiculoId?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
