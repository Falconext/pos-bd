/**
 * Lo que manda la web de un negocio cuando vende: qué productos, a quién y
 * cómo pagó. De acá sale una boleta, una factura o una nota de venta por el
 * MISMO camino del POS (mismo correlativo, IGV, kardex y caja).
 *
 * Todo lo de este archivo es puro: valida y normaliza. Lo que necesita la base
 * —encontrar los productos, ver el stock, crear el cliente— vive en
 * `erp-ventas.service.ts`. Los mensajes van para el programador de la web:
 * dicen qué campo, qué estaba mal y cómo mandarlo.
 */
import { IMPUESTO_A_AFECTACION, entero, invalido, lista, monto, presente, soloConocidos, texto } from './entrada-producto';

/** Qué se emite. La nota de venta no va a SUNAT. */
export const TIPOS_DOCUMENTO = {
  receipt: '03',
  invoice: '01',
  sales_note: 'NV',
} as const;
export type TipoDocumentoVenta = keyof typeof TIPOS_DOCUMENTO;

/** Catálogo 06 de SUNAT: documento del cliente. */
export const DOCUMENTOS_CLIENTE: Record<string, string> = {
  dni: '1',
  ruc: '6',
  ce: '4',
  passport: '7',
};

/** Los mismos nombres que guarda el POS en `medioPago`. */
export const MEDIOS_PAGO: Record<string, string> = {
  cash: 'EFECTIVO',
  card: 'TARJETA',
  yape: 'YAPE',
  plin: 'PLIN',
  transfer: 'TRANSFERENCIA',
};

/** SUNAT: una boleta de más de S/ 700 tiene que identificar al comprador. */
export const LIMITE_BOLETA_SIN_DOCUMENTO = 700;

export const MAX_ITEMS = 200;

const PISTAS_VENTA: Record<string, string> = {
  discount: 'Manda el precio final con descuento en `items[].unit_price` (con IGV).',
  currency: 'Las ventas por la API son en soles (PEN).',
  total: 'El total lo calcula Krezka con el precio y el IGV de cada producto; no se manda.',
  igv: 'El IGV lo calcula Krezka según la afectación de cada producto; no se manda.',
  series: 'La serie y el número los pone Krezka, igual que en el POS.',
  date: 'La venta se registra con la fecha y hora de Lima del momento en que llega.',
  issue_date: 'La venta se registra con la fecha y hora de Lima del momento en que llega.',
  client: 'El cliente va en `customer`.',
  products: 'Los productos van en `items`.',
  payment_method: 'El medio de pago va dentro de `payment`: { "method": "card" }.',
  shipping: 'El envío va como un ítem más sin producto: { "description": "Envío a domicilio", "quantity": 1, "unit_price": 10 }.',
  credit: 'Las ventas por la API son al contado. Para ventas al crédito usa el panel.',
};

export interface ItemVenta {
  /** Uno de los tres identifica el producto; si no hay ninguno, es ítem libre. */
  productoId?: number;
  sku?: string;
  codigoBarras?: string;
  descripcion?: string;
  cantidad: number;
  /** Precio unitario CON IGV. Si no viene, el del catálogo (con su oferta). */
  precio?: number;
  lote?: string;
  /** Solo ítems libres: Catálogo 07 ('10' gravado, '20' exonerado, '30' inafecto). */
  afectacion?: string;
  /** Solo ítems libres: unidad de SUNAT (NIU, ZZ, KGM…). */
  unidad?: string;
}

export interface ClienteVenta {
  tipoDocumento?: string; // código Catálogo 06, sin él = sin documento
  numero?: string;
  nombre?: string;
  email?: string;
  direccion?: string;
  telefono?: string;
}

export interface Venta {
  tipo?: TipoDocumentoVenta;
  sedeId?: number;
  cliente?: ClienteVenta;
  items: ItemVenta[];
  medioPago: string;
  referenciaPago?: string;
  notas?: string;
  externalId?: string;
}

function leerCliente(body: any): ClienteVenta | undefined {
  if (!presente(body, 'customer') || body.customer === null) return undefined;
  const c = body.customer;
  soloConocidos(c, ['document_type', 'document_number', 'name', 'email', 'address', 'phone'], {});
  const tipo = texto(c, 'document_type', 10, false, 'customer.document_type');
  if (tipo && tipo !== 'none' && !DOCUMENTOS_CLIENTE[tipo]) {
    throw invalido(
      'customer.document_type',
      `\`customer.document_type\` es uno de: ${Object.keys(DOCUMENTOS_CLIENTE).join(', ')}, none.`,
    );
  }
  const numero = texto(c, 'document_number', 20, false, 'customer.document_number')?.replace(/\s/g, '');
  const conDocumento = tipo && tipo !== 'none';
  if (conDocumento && !numero) {
    throw invalido('customer.document_number', `Con \`document_type\` "${tipo}" falta \`customer.document_number\`.`);
  }
  if (tipo === 'dni' && !/^\d{8}$/.test(numero!)) {
    throw invalido('customer.document_number', 'El DNI tiene 8 dígitos.');
  }
  if (tipo === 'ruc' && !/^(10|15|17|20)\d{9}$/.test(numero!)) {
    throw invalido('customer.document_number', 'El RUC tiene 11 dígitos y empieza con 10, 15, 17 o 20.');
  }
  const nombre = texto(c, 'name', 200, false, 'customer.name');
  if (conDocumento && !nombre) {
    throw invalido('customer.name', 'Con documento, falta `customer.name` (nombre o razón social).');
  }
  const email = texto(c, 'email', 120, false, 'customer.email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw invalido('customer.email', '`customer.email` no parece un correo válido.');
  }
  return {
    tipoDocumento: conDocumento ? DOCUMENTOS_CLIENTE[tipo!] : undefined,
    numero: conDocumento ? numero : undefined,
    nombre: nombre || undefined,
    email: email || undefined,
    direccion: texto(c, 'address', 250, false, 'customer.address') || undefined,
    telefono: texto(c, 'phone', 30, false, 'customer.phone') || undefined,
  };
}

function leerItem(it: any, i: number): ItemVenta {
  const donde = `items[${i}]`;
  if (it == null || typeof it !== 'object' || Array.isArray(it)) {
    throw invalido(donde, `\`${donde}\` tiene que ser un objeto.`);
  }
  soloConocidos(it, ['product_id', 'sku', 'barcode', 'description', 'quantity', 'unit_price', 'batch', 'tax', 'unit'], {
    price: `El precio va como \`${donde}.unit_price\` (con IGV).`,
    discount: PISTAS_VENTA.discount,
    variant_id: `Una talla o color es un producto propio: manda su id en \`${donde}.product_id\` (está en \`variants\` de GET /v1/erp/products/{id}).`,
  });
  const productoId = entero(it, 'product_id', `${donde}.product_id`);
  const sku = texto(it, 'sku', 60, false, `${donde}.sku`) || undefined;
  const codigoBarras = texto(it, 'barcode', 60, false, `${donde}.barcode`) || undefined;
  const identificadores = [productoId, sku, codigoBarras].filter((x) => x !== undefined).length;
  if (identificadores > 1) {
    throw invalido(donde, `En \`${donde}\` manda uno solo: \`product_id\`, \`sku\` o \`barcode\`.`);
  }
  const descripcion = texto(it, 'description', 250, false, `${donde}.description`) || undefined;

  if (!presente(it, 'quantity')) throw invalido(`${donde}.quantity`, `Falta \`${donde}.quantity\`.`);
  const cantidad = monto(it, 'quantity', { nombre: `${donde}.quantity` })!;
  if (Math.round(cantidad * 1000) / 1000 !== cantidad) {
    throw invalido(`${donde}.quantity`, `\`${donde}.quantity\` admite hasta 3 decimales.`);
  }
  const precio = monto(it, 'unit_price', { cero: true, nombre: `${donde}.unit_price` });

  if (!identificadores) {
    // Ítem sin producto del catálogo: el envío, un servicio puntual.
    if (!descripcion) {
      throw invalido(
        donde,
        `\`${donde}\` necesita \`product_id\`, \`sku\` o \`barcode\` para un producto del catálogo, o \`description\` + \`unit_price\` para un ítem libre (por ejemplo, el envío).`,
      );
    }
    if (precio === undefined) {
      throw invalido(`${donde}.unit_price`, `Un ítem libre necesita \`${donde}.unit_price\` (precio con IGV).`);
    }
  }
  const lote = texto(it, 'batch', 60, false, `${donde}.batch`)?.toUpperCase() || undefined;
  if (lote && !identificadores) {
    throw invalido(`${donde}.batch`, 'Un ítem libre no tiene lote.');
  }
  // Afectación y unidad solo se mandan en ítems libres: un producto del
  // catálogo ya tiene las suyas y mandarlas distinto descuadraría su IGV.
  const tax = texto(it, 'tax', 20, false, `${donde}.tax`);
  const unidad = texto(it, 'unit', 3, false, `${donde}.unit`)?.toUpperCase();
  if ((tax || unidad) && identificadores) {
    throw invalido(
      tax ? `${donde}.tax` : `${donde}.unit`,
      `Un producto del catálogo usa su propia afectación y unidad; \`tax\` y \`unit\` son solo para ítems libres (con \`description\`).`,
    );
  }
  if (tax && !IMPUESTO_A_AFECTACION[tax]) {
    throw invalido(`${donde}.tax`, '`tax` es `taxed` (con IGV), `exempt` (exonerado, p. ej. Ley de Amazonía) o `unaffected` (inafecto).');
  }
  if (unidad && !/^[A-Z0-9]{2,3}$/.test(unidad)) {
    throw invalido(`${donde}.unit`, '`unit` es un código de unidad de SUNAT (NIU unidad, ZZ servicio, KGM kilo…). Consulta GET /v1/erp/units.');
  }
  return { productoId, sku, codigoBarras, descripcion, cantidad, precio, lote, afectacion: tax ? IMPUESTO_A_AFECTACION[tax] : undefined, unidad };
}

export function leerVenta(body: any): Venta {
  soloConocidos(
    body,
    ['document_type', 'location_id', 'customer', 'items', 'payment', 'notes', 'external_id'],
    PISTAS_VENTA,
  );
  const tipo = texto(body, 'document_type', 20) as TipoDocumentoVenta | undefined;
  if (tipo && !TIPOS_DOCUMENTO[tipo]) {
    throw invalido('document_type', '`document_type` es "receipt" (boleta), "invoice" (factura) o "sales_note" (nota de venta, no va a SUNAT).');
  }
  const cliente = leerCliente(body);
  if (tipo === 'invoice' && cliente?.tipoDocumento !== '6') {
    throw invalido(
      'customer.document_type',
      'Una factura exige un cliente con RUC: `customer` { "document_type": "ruc", "document_number": "20…", "name": "…" }. Para consumidor final usa "receipt".',
    );
  }

  const items = lista(body, 'items', MAX_ITEMS);
  if (!items?.length) throw invalido('items', 'La venta necesita al menos un ítem en `items`.');
  // Una venta puede ser solo de ítems libres: la web que tiene su propio
  // catálogo y su propio stock y solo quiere facturar (pedido de un
  // prospecto, 2026-10-22) no tiene por qué cargar sus productos en Krezka.
  const leidos = items.map(leerItem);

  if (!presente(body, 'payment') || body.payment == null || typeof body.payment !== 'object') {
    throw invalido('payment', `Falta \`payment\`: { "method": "card" }. Medios: ${Object.keys(MEDIOS_PAGO).join(', ')}.`);
  }
  soloConocidos(body.payment, ['method', 'reference'], {
    amount: 'El monto cobrado es el total de la venta; no se manda.',
    installments: PISTAS_VENTA.credit,
  });
  const metodo = texto(body.payment, 'method', 20, true, 'payment.method')!;
  if (!MEDIOS_PAGO[metodo]) {
    throw invalido('payment.method', `\`payment.method\` es uno de: ${Object.keys(MEDIOS_PAGO).join(', ')}.`);
  }

  return {
    tipo,
    sedeId: entero(body, 'location_id'),
    cliente,
    items: leidos,
    medioPago: MEDIOS_PAGO[metodo],
    referenciaPago: texto(body.payment, 'reference', 100, false, 'payment.reference') || undefined,
    notas: texto(body, 'notes', 500) || undefined,
    externalId: texto(body, 'external_id', 64) || undefined,
  };
}

/** Si no lo dice la web: con RUC, factura; si no, boleta. */
export const tipoQueCorresponde = (v: Venta): TipoDocumentoVenta =>
  v.tipo ?? (v.cliente?.tipoDocumento === '6' ? 'invoice' : 'receipt');
