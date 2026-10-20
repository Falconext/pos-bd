/**
 * ¿Esta nota (NV, NP, TICKET…) ya se convirtió en boleta o factura?
 *
 * Una nota convertida deja de contar como venta: ya cuenta su formal. Hay dos
 * formas de estar convertida:
 *  - la de siempre: un formal la apunta en `comprobanteOrigenId`
 *    (relación `comprobantesDerivados`);
 *  - facturada junto con otras: está en `ComprobanteOrigenExtra`
 *    (relación `consolidadoEn`).
 *
 * Todos los reportes tienen que mirar las dos. Si uno mira solo la primera,
 * las notas que se facturaron juntas se cuentan dos veces.
 */
export const NOTA_CONVERTIDA = {
  OR: [{ comprobantesDerivados: { some: {} } }, { consolidadoEn: { isNot: null } }],
};

/** Para mezclar con otras condiciones del where: `{ ...NOTA_SIN_CONVERTIR }`. */
export const NOTA_SIN_CONVERTIR = {
  comprobantesDerivados: { none: {} },
  consolidadoEn: { is: null },
};

/** Select para saber en qué formal terminó la nota (cualquiera de las dos formas). */
export const SELECT_CONVERSION = {
  comprobantesDerivados: { select: { id: true, tipoDoc: true, serie: true, correlativo: true } },
  consolidadoEn: {
    select: { formal: { select: { id: true, tipoDoc: true, serie: true, correlativo: true } } },
  },
};

/** El formal en que terminó la nota, o null. */
export const formalDeNota = (nota: any): { id: number; tipoDoc: string; serie: string; correlativo: number } | null =>
  nota?.comprobantesDerivados?.[0] ?? nota?.consolidadoEn?.formal ?? null;
