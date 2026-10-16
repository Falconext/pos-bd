/**
 * Traducción del comprobante público al que entiende la emisión interna.
 *
 * El contrato de la API habla en inglés y en los términos del integrador:
 * `invoice`, `customer`, `unit_value`. Adentro el sistema habla en castellano
 * y en los de SUNAT: `tipoDoc: '01'`, `clienteId`, `nuevoValorUnitario`.
 * Esta es la aduana entre los dos, y existe por una razón concreta: para que
 * el contrato público pueda mantenerse estable aunque el modelo interno
 * cambie. Un renombre adentro no debe obligar a 20 integradores a desplegar.
 *
 * Dos cosas que el integrador NO tiene y que condicionan todo el diseño:
 *
 *  - **Nuestros IDs de producto.** Él tiene su catálogo, no el nuestro. Por
 *    eso cada línea viaja como ítem libre (`productoId: null` + descripción):
 *    la emisión interna ya lo soporta. La excepción es la detracción, que
 *    exige un producto real con código UNSPSC; se declara y se rechaza
 *    temprano con un mensaje claro en vez de dejar que SUNAT conteste 3181.
 *
 *  - **Nuestros IDs de cliente.** Manda documento y nombre; el cliente se
 *    busca o se crea en la capa de servicio. Acá solo se normaliza.
 *
 * Todo lo de este archivo es puro: entra un objeto, sale otro. La parte que
 * toca la base vive en el servicio, para que estas reglas —las que deciden si
 * un comprobante nace bien o mal— se puedan probar sin levantar nada.
 */

/** Catálogo 01 de SUNAT: qué documento se emite. */
const TIPO_DOC: Record<string, string> = {
  invoice: '01', // Factura
  receipt: '03', // Boleta de venta
};

/** Catálogo 06: tipo de documento de identidad del cliente. */
const TIPO_DOC_CLIENTE: Record<string, string> = {
  ruc: '6',
  dni: '1',
  ce: '4', // carné de extranjería
  passport: '7',
  other: '0',
};

/** Catálogo 07: afectación al IGV de cada línea. */
const AFECTACION: Record<string, string> = {
  taxed: '10', // gravado
  exempt: '20', // exonerado
  unaffected: '30', // inafecto
  export: '40', // exportación
  free: '11', // gratuito (gravado, retiro)
};

export const IGV = 0.18;

export class ErrorDeContrato extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly parametro?: string,
  ) {
    super(mensaje);
  }
}

const exigir = (condicion: unknown, codigo: string, mensaje: string, param?: string) => {
  if (!condicion) throw new ErrorDeContrato(codigo, mensaje, param);
};

/** Redondeo a 2 decimales sin el error de coma flotante de `toFixed` encadenado. */
export const aDosDecimales = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

export interface ItemPublico {
  description?: string;
  product_code?: string;
  quantity?: number;
  unit?: string;
  unit_value?: number;
  tax_affectation?: string;
  discount?: number;
}

export interface ClientePublico {
  document_type?: string;
  document_number?: string;
  name?: string;
  email?: string;
  address?: string;
}

export interface ComprobantePublico {
  issuer_id?: string;
  document_type?: string;
  series?: string;
  issue_date?: string;
  currency?: string;
  exchange_rate?: number;
  customer?: ClientePublico;
  items?: ItemPublico[];
  payment_terms?: { type?: string; due_date?: string; installments?: any[] };
  global_discount?: number;
  purchase_order?: string;
  notes?: string;
  external_id?: string;
  metadata?: Record<string, string>;
}

/**
 * Una factura exige RUC; una boleta no.
 *
 * SUNAT rechaza una factura a un DNI, pero lo hace tarde: el comprobante ya
 * consumió correlativo y el integrador ya le dijo a su usuario que se emitió.
 * Vale más detenerlo acá con un mensaje que diga exactamente qué cambiar.
 */
export const validarCliente = (
  tipoDocumento: string,
  cliente: ClientePublico | undefined,
): void => {
  exigir(cliente, 'parameter_missing', 'El campo customer es obligatorio.', 'customer');
  const c = cliente!;
  exigir(c.name?.trim(), 'parameter_missing', 'El campo customer.name es obligatorio.', 'customer.name');
  exigir(
    c.document_type && TIPO_DOC_CLIENTE[c.document_type],
    'parameter_invalid',
    `customer.document_type debe ser uno de: ${Object.keys(TIPO_DOC_CLIENTE).join(', ')}.`,
    'customer.document_type',
  );
  const numero = String(c.document_number ?? '').trim();
  exigir(numero, 'parameter_missing', 'El campo customer.document_number es obligatorio.', 'customer.document_number');

  if (tipoDocumento === 'invoice') {
    exigir(
      c.document_type === 'ruc',
      'parameter_invalid',
      'Una factura exige un cliente con RUC. Para vender a consumidor final usa document_type "receipt".',
      'customer.document_type',
    );
  }
  if (c.document_type === 'ruc') {
    exigir(/^\d{11}$/.test(numero), 'parameter_invalid', 'El RUC debe tener 11 dígitos.', 'customer.document_number');
  }
  if (c.document_type === 'dni') {
    exigir(/^\d{8}$/.test(numero), 'parameter_invalid', 'El DNI debe tener 8 dígitos.', 'customer.document_number');
  }
};

/** Una línea del comprobante, ya en los términos internos. */
export const traducirItem = (item: ItemPublico, indice: number): any => {
  const donde = `items[${indice}]`;
  exigir(item?.description?.trim(), 'parameter_missing', `${donde}.description es obligatorio.`, `${donde}.description`);

  const cantidad = Number(item.quantity);
  exigir(
    Number.isFinite(cantidad) && cantidad > 0,
    'parameter_invalid',
    `${donde}.quantity debe ser mayor que cero.`,
    `${donde}.quantity`,
  );

  const valor = Number(item.unit_value);
  exigir(
    Number.isFinite(valor) && valor >= 0,
    'parameter_invalid',
    `${donde}.unit_value es obligatorio y no puede ser negativo. Es el valor SIN IGV.`,
    `${donde}.unit_value`,
  );

  const afectacion = item.tax_affectation ?? 'taxed';
  exigir(
    AFECTACION[afectacion],
    'parameter_invalid',
    `${donde}.tax_affectation debe ser uno de: ${Object.keys(AFECTACION).join(', ')}.`,
    `${donde}.tax_affectation`,
  );

  const descuento = Number(item.discount ?? 0);
  exigir(
    Number.isFinite(descuento) && descuento >= 0,
    'parameter_invalid',
    `${donde}.discount no puede ser negativo.`,
    `${donde}.discount`,
  );
  exigir(
    descuento <= aDosDecimales(valor * cantidad),
    'parameter_invalid',
    `${donde}.discount no puede superar el valor de la línea.`,
    `${donde}.discount`,
  );

  return {
    // Ítem libre: el integrador tiene su catálogo, no el nuestro.
    productoId: null,
    descripcion: item.description!.trim(),
    codigoProducto: item.product_code?.trim() || undefined,
    cantidad,
    nuevoValorUnitario: valor,
    descuento,
    unidadVenta: item.unit?.trim() || 'NIU',
    tipoAfectacionIGV: AFECTACION[afectacion],
  };
};

/**
 * Las condiciones de pago.
 *
 * SUNAT exige que una venta al crédito declare cuándo se cobra. Sin eso el
 * comprobante se rechaza, así que se valida antes de gastar un correlativo.
 */
export const traducirPago = (
  pago: ComprobantePublico['payment_terms'],
  total: number,
): { formaPagoTipo: string; fechaVencimientoCredito?: string; cuotas?: any[] } => {
  const tipo = pago?.type ?? 'cash';
  exigir(
    tipo === 'cash' || tipo === 'credit',
    'parameter_invalid',
    'payment_terms.type debe ser "cash" o "credit".',
    'payment_terms.type',
  );
  if (tipo === 'cash') return { formaPagoTipo: 'Contado' };

  const cuotas = pago?.installments ?? [];
  exigir(
    pago?.due_date || cuotas.length > 0,
    'parameter_missing',
    'Una venta al crédito necesita payment_terms.due_date o payment_terms.installments; SUNAT la rechaza sin eso.',
    'payment_terms.due_date',
  );

  if (cuotas.length > 0) {
    const suma = aDosDecimales(
      cuotas.reduce((a: number, c: any) => a + Number(c?.amount ?? 0), 0),
    );
    exigir(
      Math.abs(suma - aDosDecimales(total)) < 0.01,
      'parameter_invalid',
      `Las cuotas suman ${suma.toFixed(2)} y el comprobante ${aDosDecimales(total).toFixed(2)}. SUNAT exige que coincidan.`,
      'payment_terms.installments',
    );
    return {
      formaPagoTipo: 'Credito',
      cuotas: cuotas.map((c: any, i: number) => ({
        numero: i + 1,
        monto: Number(c?.amount ?? 0),
        fechaVencimiento: c?.due_date,
      })),
    };
  }
  return { formaPagoTipo: 'Credito', fechaVencimientoCredito: pago!.due_date };
};

/**
 * El total del comprobante, calculado acá para poder validar las cuotas antes
 * de emitir. La cifra que vale sigue siendo la que calcula la emisión interna:
 * esta es para validar, no para guardar.
 */
export const totalEstimado = (
  items: ItemPublico[],
  descuentoGlobal = 0,
): number => {
  let total = 0;
  for (const it of items) {
    const base = Number(it.unit_value ?? 0) * Number(it.quantity ?? 0) - Number(it.discount ?? 0);
    const gravado = (it.tax_affectation ?? 'taxed') === 'taxed';
    total += gravado ? base * (1 + IGV) : base;
  }
  return aDosDecimales(total - Number(descuentoGlobal ?? 0));
};

/**
 * Toda la validación, sin tocar la base ni necesitar nada resuelto.
 *
 * Va aparte de `traducirComprobante` por un motivo que encontró la QA: la
 * emisión resolvía el cliente ANTES de validar, así que una factura a un DNI
 * —que siempre va a ser rechazada— alcanzaba para dejar un cliente nuevo en
 * la cartera del empresario. Repetida, se la llenaba de basura, y el
 * integrador ni se enteraba de que estaba ensuciando la base de su cliente.
 *
 * Devuelve las piezas ya normalizadas para no recorrer los ítems dos veces.
 */
export const validarEntrada = (
  entrada: ComprobantePublico,
): { tipoDoc: string; detalles: any[]; descuentoGlobal: number; moneda: string; pago: ReturnType<typeof traducirPago> } => {
  const tipo = entrada.document_type ?? '';
  exigir(
    TIPO_DOC[tipo],
    'parameter_invalid',
    'document_type debe ser "invoice" (factura) o "receipt" (boleta).',
    'document_type',
  );
  validarCliente(tipo, entrada.customer);

  const items = entrada.items ?? [];
  exigir(items.length > 0, 'parameter_missing', 'El comprobante necesita al menos un ítem.', 'items');

  const moneda = entrada.currency ?? 'PEN';
  exigir(moneda === 'PEN' || moneda === 'USD', 'parameter_invalid', 'currency debe ser PEN o USD.', 'currency');

  const detalles = items.map(traducirItem);
  const descuentoGlobal = Number(entrada.global_discount ?? 0);
  exigir(
    descuentoGlobal >= 0,
    'parameter_invalid',
    'global_discount no puede ser negativo.',
    'global_discount',
  );

  const pago = traducirPago(entrada.payment_terms, totalEstimado(items, descuentoGlobal));
  return { tipoDoc: TIPO_DOC[tipo], detalles, descuentoGlobal, moneda, pago };
};

/**
 * La traducción completa. No toca la base: el cliente y el tipo de operación
 * se resuelven afuera y se inyectan ya resueltos.
 *
 * Valida de nuevo a propósito: que `emitir` valide antes es una optimización
 * para no ensuciar la base, no una garantía. Quien llame a esta función
 * directamente tiene que obtener lo mismo.
 */
export const traducirComprobante = (
  entrada: ComprobantePublico,
  resuelto: { clienteId: number; tipoOperacionId: number; sedeId?: number },
): any => {
  const tipo = entrada.document_type ?? '';
  exigir(
    TIPO_DOC[tipo],
    'parameter_invalid',
    'document_type debe ser "invoice" (factura) o "receipt" (boleta).',
    'document_type',
  );
  validarCliente(tipo, entrada.customer);

  const items = entrada.items ?? [];
  exigir(items.length > 0, 'parameter_missing', 'El comprobante necesita al menos un ítem.', 'items');

  const moneda = entrada.currency ?? 'PEN';
  exigir(moneda === 'PEN' || moneda === 'USD', 'parameter_invalid', 'currency debe ser PEN o USD.', 'currency');

  const detalles = items.map(traducirItem);
  const descuentoGlobal = Number(entrada.global_discount ?? 0);
  exigir(
    descuentoGlobal >= 0,
    'parameter_invalid',
    'global_discount no puede ser negativo.',
    'global_discount',
  );

  const pago = traducirPago(entrada.payment_terms, totalEstimado(items, descuentoGlobal));

  return {
    tipoDoc: TIPO_DOC[tipo],
    serie: entrada.series?.trim() || undefined,
    fechaEmision: entrada.issue_date,
    tipoMoneda: moneda,
    tipoCambio: entrada.exchange_rate,
    clienteId: resuelto.clienteId,
    clienteName: entrada.customer!.name!.trim(),
    sedeId: resuelto.sedeId,
    tipoOperacionId: resuelto.tipoOperacionId,
    formaPagoMoneda: moneda,
    ...pago,
    detalles,
    montoDescuentoGlobal: descuentoGlobal || undefined,
    ordenCompraCliente: entrada.purchase_order?.trim() || undefined,
    observaciones: entrada.notes?.trim() || undefined,
    leyenda: '',
  };
};

/** El documento del cliente, normalizado para buscarlo o crearlo. */
export const clienteNormalizado = (c: ClientePublico) => ({
  tipoDocumento: TIPO_DOC_CLIENTE[c.document_type!],
  numeroDocumento: String(c.document_number).trim(),
  nombre: c.name!.trim(),
  email: c.email?.trim() || undefined,
  direccion: c.address?.trim() || undefined,
});
