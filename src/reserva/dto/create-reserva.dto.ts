import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateReservaDto {
  @IsInt()
  @Type(() => Number)
  productoId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Type(() => Number)
  cantidad: number;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsString()
  estado?: 'PENDIENTE' | 'CONFIRMADA' | 'CANCELADA';

  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;
}
