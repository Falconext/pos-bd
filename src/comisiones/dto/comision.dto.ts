import { IsEnum, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoComision } from '@prisma/client';

export class ListarComisionesDto {
  @IsInt()
  @Type(() => Number)
  mes: number;

  @IsInt()
  @Type(() => Number)
  anio: number;

  /** Si se proporciona, filtra solo las comisiones de ese vendedor */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  vendedorId?: number;
}

export class MarcarPagadaDto {
  @IsEnum(EstadoComision)
  estado: EstadoComision;
}
