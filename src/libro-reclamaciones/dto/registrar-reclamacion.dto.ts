import { Allow } from 'class-validator';
import type { HojaEntrada } from '../libro-reclamaciones.reglas';

/**
 * Cuerpo del formulario público. Los campos se declaran solo para que el
 * ValidationPipe (whitelist) no los descarte; la validación real la hace
 * `validarHoja`, que junta todos los errores en un solo 400.
 *
 * Van tipados como `unknown` a propósito: con `enableImplicitConversion` un
 * `boolean` convertiría el texto "false" en `true` antes de validar.
 */
export class RegistrarReclamacionDto implements HojaEntrada {
  @Allow() tipo?: unknown;
  @Allow() nombres?: unknown;
  @Allow() tipoDocumento?: unknown;
  @Allow() numeroDocumento?: unknown;
  @Allow() domicilio?: unknown;
  @Allow() telefono?: unknown;
  @Allow() email?: unknown;
  @Allow() menorDeEdad?: unknown;
  @Allow() apoderadoNombre?: unknown;
  @Allow() apoderadoDocumento?: unknown;
  @Allow() bienTipo?: unknown;
  @Allow() bienDescripcion?: unknown;
  @Allow() montoReclamado?: unknown;
  @Allow() pedidoCodigo?: unknown;
  @Allow() detalle?: unknown;
  @Allow() pedidoConsumidor?: unknown;
  @Allow() aceptaDeclaracion?: unknown;
  /** Honeypot: debe venir vacío. */
  @Allow() website?: unknown;
}

export class ResponderReclamacionDto {
  @Allow() respuesta?: unknown;
}
