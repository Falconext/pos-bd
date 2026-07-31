import { IsOptional, IsString } from 'class-validator';

export class ConciliacionImportarDto {
  @IsString()
  archivoBase64: string; // contenido del .xlsx/.csv en base64 (con o sin prefijo data:)

  // Rango opcional para acotar la búsqueda de pagos del sistema (YYYY-MM-DD).
  @IsOptional()
  @IsString()
  fechaInicio?: string;

  @IsOptional()
  @IsString()
  fechaFin?: string;
}
