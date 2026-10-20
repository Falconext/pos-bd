/**
 * Notas que viajan en el envío de otra (EnvioDespachoNota).
 *
 * Las listas (Notas de venta, Panel de ventas) leen `envioDespacho` de cada
 * nota para decir "en camino / entregado" y ofrecer "Coordinar envío". Una nota
 * agrupada no tiene despacho propio: sin esto aparecía "sin envío" y el
 * vendedor le creaba un segundo despacho (y una segunda guía) al mismo paquete.
 */

/** Select del despacho compartido, con los mismos campos que el propio. */
export const selectDespachoAgrupado = (camposDespacho: Record<string, any>) => ({
  select: {
    despacho: {
      select: {
        ...camposDespacho,
        comprobanteId: true,
        comprobante: { select: { serie: true, correlativo: true } },
      },
    },
  },
});

/**
 * Deja en `envioDespacho` el despacho compartido cuando la nota no tiene uno
 * propio, marcado con `agrupadoEn` (la nota que lo lleva) y su `comprobanteId`
 * para que "Editar despacho" abra ese envío y no cree otro.
 */
export function resolverDespachoAgrupado<T extends { envioDespacho?: any; despachoAgrupado?: any }>(nota: T): T {
  if (nota?.envioDespacho || !nota?.despachoAgrupado?.despacho) return nota;
  const { comprobante, ...despacho } = nota.despachoAgrupado.despacho;
  (nota as any).envioDespacho = {
    ...despacho,
    agrupadoEn: comprobante ? `${comprobante.serie}-${String(comprobante.correlativo).padStart(8, '0')}` : null,
  };
  return nota;
}
