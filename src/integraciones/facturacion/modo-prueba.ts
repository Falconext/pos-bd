/**
 * Modo prueba de la API de facturación.
 *
 * La documentación prometía que una clave `sk_test_` "no tiene validez
 * tributaria y no consume tu saldo", pero el código nunca leyó el entorno de
 * la clave: con `sk_test_` se emitía de verdad, se gastaba el correlativo y
 * el medidor lo cobraba. Lo encontró la revisión del 24-10.
 *
 * Ahora una clave de prueba corre TODAS las validaciones de verdad —emisor
 * del integrador, cliente, ítems, cuotas, comprobante afectado— y en el
 * último paso, en vez de emitir, devuelve cómo habría quedado: `livemode:
 * false`, `status: "test"` y el número que le tocaría. No se crea nada, no se
 * gasta número, no va a SUNAT y no se cobra. Es lo que permite probar la
 * integración el primer día, antes de pasar a producción.
 */
import { ComprobantePublico, IGV, aDosDecimales } from './fachada';

/** La clave del request es de prueba. */
export const esClaveDePrueba = (req: any): boolean => req?.apiKey?.entorno === 'test';

const TIPO_PUBLICO: Record<string, string> = { invoice: 'invoice', receipt: 'receipt' };

/** Cómo habría quedado el comprobante. Puro: se prueba sin base. */
export function comprobanteSimulado(
  entrada: ComprobantePublico,
  issuerId: string,
  siguiente: { serie: string; correlativo: number } | null,
) {
  const totales = { taxable: 0, exempt: 0, unaffected: 0, export: 0, discount: 0, tax: 0, total: 0 };
  const items = (entrada.items ?? []).map((it) => {
    const cantidad = Number(it.quantity) || 0;
    const valor = Number(it.unit_value) || 0;
    const descuento = Number(it.discount ?? 0) || 0;
    const base = aDosDecimales(valor * cantidad - descuento);
    const afectacion = it.tax_affectation ?? 'taxed';
    const igv = afectacion === 'taxed' ? aDosDecimales(base * IGV) : 0;
    if (afectacion === 'taxed') totales.taxable += base;
    else if (afectacion === 'exempt') totales.exempt += base;
    else if (afectacion === 'unaffected') totales.unaffected += base;
    else if (afectacion === 'export') totales.export += base;
    totales.tax += igv;
    return {
      description: String(it.description ?? '').trim(),
      quantity: cantidad,
      unit: it.unit?.trim() || 'NIU',
      unit_value: aDosDecimales(valor),
      discount: aDosDecimales(descuento),
      tax_affectation: afectacion,
      tax: igv,
    };
  });
  totales.discount = aDosDecimales(Number(entrada.global_discount ?? 0) || 0);
  for (const k of ['taxable', 'exempt', 'unaffected', 'export', 'tax'] as const) totales[k] = aDosDecimales(totales[k]);
  totales.total = aDosDecimales(
    totales.taxable + totales.exempt + totales.unaffected + totales.export + totales.tax - totales.discount,
  );
  const tipo = TIPO_PUBLICO[String(entrada.document_type)] ?? 'invoice';
  return {
    id: null,
    object: 'invoice',
    livemode: false,
    issuer_id: issuerId,
    document_type: tipo,
    status: 'test',
    number_preview: siguiente ? `${siguiente.serie}-${String(siguiente.correlativo).padStart(8, '0')}` : null,
    issue_date: entrada.issue_date ?? new Date().toISOString().slice(0, 10),
    currency: entrada.currency ?? 'PEN',
    customer: entrada.customer
      ? {
          document_type: entrada.customer.document_type,
          document_number: entrada.customer.document_number,
          name: entrada.customer.name,
          email: entrada.customer.email,
          address: entrada.customer.address,
        }
      : undefined,
    items,
    totals: totales,
    external_id: entrada.external_id,
    message: 'Clave de prueba: se validó todo, pero no se emitió ni se envió a SUNAT. No se cobra.',
  };
}

/** La nota de crédito como habría quedado: afecta el total del comprobante. */
export function notaCreditoSimulada(
  afectado: { apiPublicId?: string | null; serie: string; correlativo: number; mtoImpVenta?: number | null; tipoMoneda?: string | null },
  issuerId: string,
  motivo: string,
  descripcion: string,
  siguiente: { serie: string; correlativo: number } | null,
) {
  return {
    id: null,
    object: 'credit_note',
    livemode: false,
    issuer_id: issuerId,
    document_type: 'credit_note',
    status: 'test',
    number_preview: siguiente ? `${siguiente.serie}-${String(siguiente.correlativo).padStart(8, '0')}` : null,
    affects_invoice_id: afectado.apiPublicId,
    affects_number: `${afectado.serie}-${String(afectado.correlativo).padStart(8, '0')}`,
    reason_code: motivo,
    description: descripcion,
    currency: afectado.tipoMoneda ?? 'PEN',
    // Contra una factura de prueba no hay total que copiar: null, no 0.
    totals: { total: afectado.mtoImpVenta == null ? null : aDosDecimales(Number(afectado.mtoImpVenta) || 0) },
    message: 'Clave de prueba: se validó todo, pero la nota no se emitió ni se envió a SUNAT.',
  };
}
