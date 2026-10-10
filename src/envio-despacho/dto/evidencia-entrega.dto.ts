import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * En multipart todo llega como texto, y `Boolean('false')` es `true`.
 *
 * Esto se lee del objeto CRUDO (`obj[key]`) y no de `value`, porque el
 * ValidationPipe de la aplicación corre con `enableImplicitConversion` y ya
 * convirtió el texto antes de llegar acá: para cuando este transform se
 * ejecuta, `value` de un "false" vale `true`. Mirando el crudo se decide
 * sobre lo que de verdad mandó el formulario.
 *
 * Lo que estaba en juego: marcar entregados —y avisarle al cliente— justo los
 * despachos que pidieron NO marcarse.
 */
const siONo = () =>
  Transform(({ obj, key, value }) => {
    const crudo = (obj as Record<string, unknown>)?.[key as string] ?? value;
    if (typeof crudo === 'boolean') return crudo;
    if (crudo == null || crudo === '') return undefined;
    return ['true', '1', 'si', 'sí', 'on'].includes(
      String(crudo).trim().toLowerCase(),
    );
  });

export enum TipoEvidenciaEntrega {
  FOTO_PAQUETE = 'FOTO_PAQUETE',
  FOTO_RECEPTOR = 'FOTO_RECEPTOR',
  FIRMA = 'FIRMA',
  DOCUMENTO = 'DOCUMENTO',
}

export class RegistrarEvidenciaDto {
  @IsOptional()
  @IsEnum(TipoEvidenciaEntrega)
  tipo?: TipoEvidenciaEntrega;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  nota?: string;

  /**
   * Cuándo se entregó de verdad. El motorizado suele subir las fotos del día
   * al volver, así que la hora de subida no sirve como hora de entrega.
   */
  @IsOptional()
  @IsISO8601()
  tomadaEn?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  repartidorId?: number;

  /**
   * Marcar el despacho como ENTREGADO en el mismo acto. Viene de multipart,
   * donde todo llega como texto: "true"/"1" cuentan como sí.
   */
  @IsOptional()
  @siONo()
  @IsBoolean()
  marcarEntregado?: boolean;
}

export class EntregasSinEvidenciaQueryDto {
  @IsOptional()
  @IsString()
  desde?: string;

  @IsOptional()
  @IsString()
  hasta?: string;
}
