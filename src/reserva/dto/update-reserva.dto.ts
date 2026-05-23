import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateReservaDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cantidad?: number;

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
