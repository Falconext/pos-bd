/**
 * Lo que la web del negocio manda para crear o cambiar un producto, validado
 * y traducido a los campos internos. No toca la base.
 *
 * Los errores llevan `param`: el programador de la web tiene que saber qué
 * campo arreglar sin leer el código de Krezka.
 */
import { BadRequestException } from '@nestjs/common';

export const IMPUESTO_A_AFECTACION: Record<string, string> = {
  taxed: '10', // gravado con IGV
  exempt: '20', // exonerado
  unaffected: '30', // inafecto
};

/** Motivos de ajuste de stock, los mismos del Kardex (motivo-ajuste-stock.ts). */
export const MOTIVOS_AJUSTE: Record<string, string> = {
  stock_count: 'CONTEO',
  found: 'ENCONTRADO',
  customer_return: 'DEVOLUCION_CLIENTE',
  damaged: 'MERMA',
  expired: 'VENCIDO',
  lost: 'PERDIDA',
  internal_use: 'CONSUMO_INTERNO',
  supplier_return: 'DEVOLUCION_PROVEEDOR',
  correction: 'ERROR_REGISTRO',
  other: 'OTRO',
};

const invalido = (param: string, message: string) =>
  new BadRequestException({ type: 'invalid_request_error', code: 'parameter_invalid', message, param });

const presente = (o: any, k: string) => o != null && Object.prototype.hasOwnProperty.call(o, k);

function texto(o: any, k: string, max: number, requerido = false): string | undefined {
  if (!presente(o, k) || o[k] === null) {
    if (requerido) throw invalido(k, `Falta \`${k}\`.`);
    return undefined;
  }
  if (typeof o[k] !== 'string') throw invalido(k, `\`${k}\` tiene que ser texto.`);
  const v = o[k].trim();
  if (requerido && !v) throw invalido(k, `\`${k}\` no puede estar vacío.`);
  if (v.length > max) throw invalido(k, `\`${k}\` admite hasta ${max} caracteres.`);
  return v;
}

function monto(o: any, k: string, opts: { requerido?: boolean; cero?: boolean } = {}): number | undefined {
  if (!presente(o, k) || o[k] === null) {
    if (opts.requerido) throw invalido(k, `Falta \`${k}\`.`);
    return undefined;
  }
  const n = typeof o[k] === 'number' ? o[k] : NaN;
  if (!Number.isFinite(n) || n < 0 || (!opts.cero && n === 0) || n > 10_000_000) {
    throw invalido(k, `\`${k}\` tiene que ser un número ${opts.cero ? 'mayor o igual a 0' : 'mayor que 0'}.`);
  }
  return Math.round(n * 1e4) / 1e4;
}

function entero(o: any, k: string): number | undefined {
  if (!presente(o, k) || o[k] === null) return undefined;
  if (!Number.isInteger(o[k]) || o[k] <= 0) throw invalido(k, `\`${k}\` tiene que ser un id válido.`);
  return o[k];
}

function booleano(o: any, k: string): boolean | undefined {
  if (!presente(o, k) || o[k] === null) return undefined;
  if (typeof o[k] !== 'boolean') throw invalido(k, `\`${k}\` tiene que ser true o false.`);
  return o[k];
}

const CAMPOS_ALTA = [
  'name', 'price', 'sku', 'barcode', 'description', 'category_id', 'unit', 'tax', 'currency',
  'sale_price', 'published_in_store', 'stock', 'location_id',
];
const CAMPOS_CAMBIO = ['name', 'price', 'sku', 'barcode', 'description', 'category_id', 'sale_price', 'published_in_store'];

function soloConocidos(o: any, permitidos: string[]) {
  if (o == null || typeof o !== 'object' || Array.isArray(o)) {
    throw invalido('body', 'El cuerpo tiene que ser un objeto JSON.');
  }
  const desconocido = Object.keys(o).find((k) => !permitidos.includes(k));
  if (desconocido) {
    const pista = desconocido === 'stock'
      ? ' El stock se cambia con POST /v1/erp/products/{id}/stock_adjustments, para que quede en el kardex.'
      : '';
    throw invalido(desconocido, `\`${desconocido}\` no es un campo que se pueda enviar acá.${pista}`);
  }
}

export interface AltaProducto {
  descripcion: string;
  precioUnitario: number;
  codigo?: string;
  codigoBarras?: string;
  descripcionLarga?: string;
  categoriaId?: number;
  unidad?: string;
  tipoAfectacionIGV: string;
  moneda: 'PEN' | 'USD';
  precioOferta?: number;
  publicarEnTienda?: boolean;
  stock: number;
  sedeId?: number;
}

export function leerAlta(body: any): AltaProducto {
  soloConocidos(body, CAMPOS_ALTA);
  const tax = texto(body, 'tax', 20) ?? 'taxed';
  if (!IMPUESTO_A_AFECTACION[tax]) throw invalido('tax', '`tax` es `taxed`, `exempt` o `unaffected`.');
  const currency = (texto(body, 'currency', 3) ?? 'PEN').toUpperCase();
  if (currency !== 'PEN' && currency !== 'USD') throw invalido('currency', '`currency` es `PEN` o `USD`.');
  const precio = monto(body, 'price', { requerido: true })!;
  const oferta = monto(body, 'sale_price');
  if (oferta !== undefined && oferta >= precio) {
    throw invalido('sale_price', '`sale_price` tiene que ser menor que `price`.');
  }
  return {
    descripcion: texto(body, 'name', 250, true)!,
    precioUnitario: precio,
    codigo: texto(body, 'sku', 60) || undefined,
    codigoBarras: texto(body, 'barcode', 60) || undefined,
    descripcionLarga: texto(body, 'description', 5000) || undefined,
    categoriaId: entero(body, 'category_id'),
    unidad: (texto(body, 'unit', 10) || undefined)?.toUpperCase(),
    tipoAfectacionIGV: IMPUESTO_A_AFECTACION[tax],
    moneda: currency,
    precioOferta: oferta,
    publicarEnTienda: booleano(body, 'published_in_store'),
    stock: monto(body, 'stock', { cero: true }) ?? 0,
    sedeId: entero(body, 'location_id'),
  };
}

export interface CambioProducto {
  descripcion?: string;
  precioUnitario?: number;
  codigo?: string;
  codigoBarras?: string;
  descripcionLarga?: string;
  categoriaId?: number | null;
  /** null = quitar la oferta. */
  precioOferta?: number | null;
  publicarEnTienda?: boolean;
}

export function leerCambio(body: any): CambioProducto {
  soloConocidos(body, CAMPOS_CAMBIO);
  if (!Object.keys(body).length) throw invalido('body', 'No mandaste ningún campo para cambiar.');
  const r: CambioProducto = {
    descripcion: presente(body, 'name') ? texto(body, 'name', 250, true) : undefined,
    precioUnitario: monto(body, 'price'),
    codigo: presente(body, 'sku') ? texto(body, 'sku', 60, true) : undefined,
    codigoBarras: presente(body, 'barcode') ? (texto(body, 'barcode', 60) ?? '') : undefined,
    descripcionLarga: presente(body, 'description') ? (texto(body, 'description', 5000) ?? '') : undefined,
    categoriaId: presente(body, 'category_id') ? (body.category_id === null ? null : entero(body, 'category_id')) : undefined,
    precioOferta: presente(body, 'sale_price') ? (body.sale_price === null ? null : monto(body, 'sale_price')) : undefined,
    publicarEnTienda: booleano(body, 'published_in_store'),
  };
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as CambioProducto;
}

export interface AjusteStock {
  sedeId?: number;
  /** El stock final, o cuánto sumar/restar: exactamente uno de los dos. */
  nuevo?: number;
  cambio?: number;
  /** El motivo interno (Kardex) y el que mandó la web. */
  motivo: string;
  razon: string;
  nota?: string;
}

export function leerAjuste(body: any): AjusteStock {
  soloConocidos(body, ['location_id', 'quantity', 'change', 'reason', 'note']);
  const tieneQuantity = presente(body, 'quantity');
  const tieneChange = presente(body, 'change');
  if (tieneQuantity === tieneChange) {
    throw invalido('quantity', 'Manda `quantity` (el stock final) o `change` (cuánto sumar o restar), uno solo.');
  }
  let cambio: number | undefined;
  if (tieneChange) {
    const n = body.change;
    if (typeof n !== 'number' || !Number.isFinite(n) || n === 0 || Math.abs(n) > 10_000_000) {
      throw invalido('change', '`change` tiene que ser un número distinto de 0 (negativo para restar).');
    }
    cambio = Math.round(n * 1000) / 1000;
  }
  const reason = texto(body, 'reason', 30, true)!;
  if (!MOTIVOS_AJUSTE[reason]) {
    throw invalido('reason', `\`reason\` es uno de: ${Object.keys(MOTIVOS_AJUSTE).join(', ')}.`);
  }
  return {
    sedeId: entero(body, 'location_id'),
    nuevo: tieneQuantity ? monto(body, 'quantity', { cero: true }) : undefined,
    cambio,
    motivo: MOTIVOS_AJUSTE[reason],
    razon: reason,
    nota: texto(body, 'note', 300) || undefined,
  };
}
