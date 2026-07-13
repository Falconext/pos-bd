import { IsString, IsOptional, IsInt, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum EntidadDocumentoLogistica {
  VEHICULO = 'VEHICULO',
  CONDUCTOR = 'CONDUCTOR',
}

export class CreateDocumentoDto {
  @IsEnum(EntidadDocumentoLogistica)
  entidad: EntidadDocumentoLogistica;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vehiculoId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  conductorId?: number;

  @IsString()
  tipo: string; // SOAT, REVISION_TECNICA, SEGURO, LICENCIA, DNI, ...

  @IsOptional()
  @IsString()
  numero?: string;

  @IsOptional()
  @IsString()
  fechaEmision?: string; // ISO

  @IsString()
  fechaVencimiento: string; // ISO

  @IsOptional()
  @IsString()
  archivoUrl?: string;

  @IsOptional()
  @IsString()
  notas?: string;
}
