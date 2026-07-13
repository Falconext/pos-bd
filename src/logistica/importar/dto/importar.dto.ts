import { IsString } from 'class-validator';

export class ImportarDto {
  @IsString()
  archivoBase64: string; // contenido del .xlsx/.csv en base64 (con o sin prefijo data:)
}
