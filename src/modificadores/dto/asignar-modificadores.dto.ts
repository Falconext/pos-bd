import { IsArray, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class AsignarGrupoDto {
  @IsInt()
  @Type(() => Number)
  grupoId: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  ordenOverride?: number;
}

export class AsignarModificadoresProductoDto {
  @IsArray()
  @Type(() => AsignarGrupoDto)
  grupos: AsignarGrupoDto[];
}
