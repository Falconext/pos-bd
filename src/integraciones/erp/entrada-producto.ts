/**
 * Lo que la web del negocio manda para crear o cambiar un producto, validado
 * y traducido a los campos internos. No toca la base.
 *
 * Los errores llevan `param` y dicen qué hacer: quien integra es un
 * programador que no conoce Krezka, y un "400 Bad Request" sin más lo deja
 * adivinando. Las reglas que dependen del negocio (si su rubro maneja lotes,
 * cuántas fotos admite) se aplican en el servicio, que tiene la empresa.
 */
import { BadRequestException } from '@nestjs/common';

export const IMPUESTO_A_AFECTACION: Record<string, string> = {
  taxed: '10', // gravado con IGV
  exempt: '20', // exonerado (p. ej. Ley de Amazonía)
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

/** Límites para que un error de la web no cree 10 000 variantes de golpe. */
export const MAX_OPCIONES_VARIANTE = 3;
export const MAX_VALORES_POR_OPCION = 30;
export const MAX_VARIANTES = 200;

export const invalido = (param: string, message: string, code = 'parameter_invalid') =>
  new BadRequestException({ type: 'invalid_request_error', code, message, param });

export const presente = (o: any, k: string) => o != null && Object.prototype.hasOwnProperty.call(o, k);

export function texto(o: any, k: string, max: number, requerido = false, nombre = k): string | undefined {
  if (!presente(o, k) || o[k] === null) {
    if (requerido) throw invalido(nombre, `Falta \`${nombre}\`.`);
    return undefined;
  }
  if (typeof o[k] !== 'string') throw invalido(nombre, `\`${nombre}\` tiene que ser texto.`);
  const v = o[k].trim();
  if (requerido && !v) throw invalido(nombre, `\`${nombre}\` no puede estar vacío.`);
  if (v.length > max) throw invalido(nombre, `\`${nombre}\` admite hasta ${max} caracteres.`);
  return v;
}

export function monto(
  o: any,
  k: string,
  opts: { requerido?: boolean; cero?: boolean; nombre?: string } = {},
): number | undefined {
  const nombre = opts.nombre ?? k;
  if (!presente(o, k) || o[k] === null) {
    if (opts.requerido) throw invalido(nombre, `Falta \`${nombre}\`.`);
    return undefined;
  }
  const n = typeof o[k] === 'number' ? o[k] : NaN;
  if (!Number.isFinite(n) || n < 0 || (!opts.cero && n === 0) || n > 10_000_000) {
    const pista = typeof o[k] === 'string' ? ' Mándalo como número, sin comillas (31.5, no "31.5").' : '';
    throw invalido(nombre, `\`${nombre}\` tiene que ser un número ${opts.cero ? 'mayor o igual a 0' : 'mayor que 0'}.${pista}`);
  }
  return Math.round(n * 1e4) / 1e4;
}

export function entero(o: any, k: string, nombre = k, minimo = 1): number | undefined {
  if (!presente(o, k) || o[k] === null) return undefined;
  if (!Number.isInteger(o[k]) || o[k] < minimo) {
    throw invalido(nombre, `\`${nombre}\` tiene que ser un número entero${minimo > 1 ? ` desde ${minimo}` : ' (un id válido)'}.`);
  }
  return o[k];
}

function booleano(o: any, k: string, nombre = k): boolean | undefined {
  if (!presente(o, k) || o[k] === null) return undefined;
  if (typeof o[k] !== 'boolean') throw invalido(nombre, `\`${nombre}\` tiene que ser true o false.`);
  return o[k];
}

export function lista(o: any, k: string, max: number): any[] | undefined {
  if (!presente(o, k) || o[k] === null) return undefined;
  if (!Array.isArray(o[k])) throw invalido(k, `\`${k}\` tiene que ser una lista.`);
  if (o[k].length > max) throw invalido(k, `\`${k}\` admite hasta ${max} elementos.`);
  return o[k];
}

/** Lo que alguien podría mandar y no se maneja así: el mensaje dice dónde va. */
const PISTAS: Record<string, string> = {
  stock: 'El stock se cambia con POST /v1/erp/products/{id}/stock_adjustments, para que quede en el kardex.',
  cost_price: 'El costo se manda como `cost` (solo al crear); después cambia con las compras.',
  kit: 'Los kits y combos se arman desde el panel (Mi negocio → Combos) con productos ya creados.',
  components: 'Los kits y combos se arman desde el panel (Mi negocio → Combos) con productos ya creados.',
  combo: 'Los kits y combos se arman desde el panel (Mi negocio → Combos) con productos ya creados.',
  lots: 'Los lotes se cargan con `batch` al crear o en stock_adjustments.',
  lot: 'Los lotes se cargan con `batch` al crear o en stock_adjustments.',
  expiration_date: 'El vencimiento va dentro de `batch`: { "number": "L001", "expires_on": "2027-05-31" }.',
  image: 'Las fotos van en `images`: una lista de URLs https.',
  image_url: 'Las fotos van en `images`: una lista de URLs https.',
  category: 'La categoría va como `category_id` (consulta GET /v1/erp/categories).',
  brand: 'La marca va como `brand_id` (consulta GET /v1/erp/brands).',
  serial_numbers: 'Los números de serie se registran al vender, no en el producto.',
  type: 'El tipo (producto o servicio) se elige al crear y no se cambia después.',
  variant_options: 'Para agregar tallas o colores a un producto que ya existe, usa el panel por ahora.',
  variants: 'Para agregar tallas o colores a un producto que ya existe, usa el panel por ahora. El stock de cada variante se ajusta con su propio id en stock_adjustments.',
  cost: 'El costo cambia con las compras, no editando el producto.',
};

export function soloConocidos(o: any, permitidos: string[], pistas: Record<string, string> = PISTAS) {
  if (o == null || typeof o !== 'object' || Array.isArray(o)) {
    throw invalido('body', 'El cuerpo tiene que ser un objeto JSON (Content-Type: application/json).');
  }
  const desconocido = Object.keys(o).find((k) => !permitidos.includes(k));
  if (desconocido) {
    const pista = pistas[desconocido] ? ` ${pistas[desconocido]}` : '';
    throw invalido(desconocido, `\`${desconocido}\` no es un campo que se pueda enviar acá.${pista}`, 'unknown_parameter');
  }
}

function imagenes(o: any): string[] | undefined {
  const l = lista(o, 'images', 20);
  if (!l) return undefined;
  return l.map((u, i) => {
    if (typeof u !== 'string' || !/^https:\/\/\S+$/i.test(u.trim()) || u.length > 1000) {
      throw invalido(`images[${i}]`, `\`images[${i}]\` tiene que ser una URL https pública de la foto.`);
    }
    return u.trim();
  });
}

function preciosMayorista(o: any) {
  const l = lista(o, 'wholesale_prices', 10);
  if (!l) return undefined;
  const r = l.map((x, i) => {
    const p = `wholesale_prices[${i}]`;
    if (!x || typeof x !== 'object') throw invalido(p, `\`${p}\` tiene que ser { "min_quantity": 12, "price": 2.5 }.`);
    return {
      cantidadMinima: entero(x, 'min_quantity', `${p}.min_quantity`, 2) ?? (() => { throw invalido(`${p}.min_quantity`, `Falta \`${p}.min_quantity\` (desde 2).`); })(),
      precio: monto(x, 'price', { requerido: true, nombre: `${p}.price` })!,
    };
  });
  const repetida = r.find((x, i) => r.findIndex((y) => y.cantidadMinima === x.cantidadMinima) !== i);
  if (repetida) throw invalido('wholesale_prices', `Hay dos precios por mayor desde ${repetida.cantidadMinima} unidades.`);
  return r.sort((a, b) => a.cantidadMinima - b.cantidadMinima);
}

function presentaciones(o: any) {
  const l = lista(o, 'packs', 20);
  if (!l) return undefined;
  return l.map((x, i) => {
    const p = `packs[${i}]`;
    if (!x || typeof x !== 'object') {
      throw invalido(p, `\`${p}\` tiene que ser { "barcode": "775…", "units": 12, "price": 30, "name": "Caja x12" }.`);
    }
    return {
      codigo: texto(x, 'barcode', 60, true, `${p}.barcode`)!,
      unidadesPorPaquete: entero(x, 'units', `${p}.units`, 2) ?? (() => { throw invalido(`${p}.units`, `Falta \`${p}.units\`: cuántas unidades trae (desde 2).`); })(),
      precioPaquete: monto(x, 'price', { requerido: true, nombre: `${p}.price` })!,
      alias: texto(x, 'name', 60, false, `${p}.name`) || undefined,
    };
  });
}

const CAMPOS_FARMACIA: Record<string, string> = {
  active_ingredient: 'principioActivo',
  concentration: 'concentracion',
  presentation: 'presentacion',
  laboratory: 'laboratorio',
  digemid_code: 'codigoDigemid',
};

function farmacia(o: any) {
  if (!presente(o, 'pharmacy') || o.pharmacy === null) return undefined;
  const f = o.pharmacy;
  if (typeof f !== 'object' || Array.isArray(f)) throw invalido('pharmacy', '`pharmacy` tiene que ser un objeto.');
  const permitidos = [...Object.keys(CAMPOS_FARMACIA), 'requires_prescription', 'controlled', 'refrigerated'];
  const otro = Object.keys(f).find((k) => !permitidos.includes(k));
  if (otro) throw invalido(`pharmacy.${otro}`, `\`pharmacy.${otro}\` no existe. Campos: ${permitidos.join(', ')}.`, 'unknown_parameter');
  const r: Record<string, unknown> = {};
  for (const [k, interno] of Object.entries(CAMPOS_FARMACIA)) {
    const v = texto(f, k, 200, false, `pharmacy.${k}`);
    if (v !== undefined) r[interno] = v;
  }
  const receta = booleano(f, 'requires_prescription', 'pharmacy.requires_prescription');
  const controlado = booleano(f, 'controlled', 'pharmacy.controlled');
  const frio = booleano(f, 'refrigerated', 'pharmacy.refrigerated');
  if (receta !== undefined) r.requiereReceta = receta;
  if (controlado !== undefined) r.controlado = controlado;
  if (frio !== undefined) r.refrigerado = frio;
  return r;
}

export interface Lote {
  numero: string;
  /** YYYY-MM-DD; obligatorio solo al crear un lote nuevo. */
  vence?: Date;
  costo?: number;
}

/** Una fecha YYYY-MM-DD de Lima; null la quita; undefined = no vino. */
function fecha(o: any, k: string, horaLima = '12:00:00'): Date | null | undefined {
  if (!presente(o, k)) return undefined;
  if (o[k] === null) return null;
  const s = String(o[k]);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${horaLima}-05:00`) : new Date(NaN);
  if (Number.isNaN(d.getTime())) throw invalido(k, `\`${k}\` va como fecha YYYY-MM-DD (ej. 2026-12-31).`);
  return d;
}

/** Las fechas de la oferta: desde el inicio del primer día hasta el final del último. */
function fechasOferta(o: any): { ofertaDesde?: Date | null; ofertaHasta?: Date | null } {
  const desde = fecha(o, 'sale_starts_on', '00:00:00');
  const hasta = fecha(o, 'sale_ends_on', '23:59:59');
  if (desde && hasta && hasta < desde) throw invalido('sale_ends_on', '`sale_ends_on` es antes de `sale_starts_on`.');
  return { ofertaDesde: desde, ofertaHasta: hasta };
}

function lote(o: any, param = 'batch'): Lote | undefined {
  if (!presente(o, param) || o[param] === null) return undefined;
  const b = o[param];
  if (typeof b !== 'object' || Array.isArray(b)) {
    throw invalido(param, `\`${param}\` tiene que ser { "number": "L001", "expires_on": "2027-05-31" }.`);
  }
  const numero = texto(b, 'number', 60, true, `${param}.number`)!;
  let vence: Date | undefined;
  if (presente(b, 'expires_on') && b.expires_on !== null) {
    const s = String(b.expires_on);
    vence = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00-05:00`) : new Date(NaN);
    if (Number.isNaN(vence.getTime())) {
      throw invalido(`${param}.expires_on`, `\`${param}.expires_on\` va como fecha YYYY-MM-DD (ej. 2027-05-31).`);
    }
  }
  return { numero, vence, costo: monto(b, 'cost', { nombre: `${param}.cost` }) };
}

export interface OpcionVariante {
  nombre: string;
  valores: string[];
}
export interface VarianteEntrada {
  valores: Record<string, string>;
  codigo?: string;
  codigoBarras?: string;
  precio?: number;
  imagen?: string;
  stock: number;
}

function opcionesVariante(o: any): OpcionVariante[] | undefined {
  const l = lista(o, 'variant_options', MAX_OPCIONES_VARIANTE);
  if (!l) return undefined;
  if (!l.length) throw invalido('variant_options', '`variant_options` no puede estar vacía.');
  const opciones = l.map((x, i) => {
    const p = `variant_options[${i}]`;
    if (!x || typeof x !== 'object') {
      throw invalido(p, `\`${p}\` tiene que ser { "name": "Talla", "values": ["S", "M", "L"] }.`);
    }
    const nombre = texto(x, 'name', 40, true, `${p}.name`)!;
    if (!Array.isArray(x.values) || !x.values.length) {
      throw invalido(`${p}.values`, `\`${p}.values\` tiene que ser una lista con al menos un valor.`);
    }
    if (x.values.length > MAX_VALORES_POR_OPCION) {
      throw invalido(`${p}.values`, `\`${p}.values\` admite hasta ${MAX_VALORES_POR_OPCION} valores.`);
    }
    const valores = x.values.map((v: unknown, j: number) => {
      if ((typeof v !== 'string' && typeof v !== 'number') || !String(v).trim() || String(v).length > 40) {
        throw invalido(`${p}.values[${j}]`, `\`${p}.values[${j}]\` tiene que ser un texto corto (ej. "M" o "38").`);
      }
      return String(v).trim();
    });
    const dup = valores.find((v: string, j: number) => valores.findIndex((w: string) => w.toUpperCase() === v.toUpperCase()) !== j);
    if (dup) throw invalido(`${p}.values`, `"${dup}" está repetido en ${nombre}.`);
    return { nombre, valores };
  });
  const dupNombre = opciones.find((x, i) => opciones.findIndex((y) => y.nombre.toUpperCase() === x.nombre.toUpperCase()) !== i);
  if (dupNombre) throw invalido('variant_options', `La opción "${dupNombre.nombre}" está dos veces.`);
  const combinaciones = opciones.reduce((a, x) => a * x.valores.length, 1);
  if (combinaciones > MAX_VARIANTES) {
    throw invalido('variant_options', `Esas opciones dan ${combinaciones} combinaciones; el máximo es ${MAX_VARIANTES}.`);
  }
  return opciones;
}

function variantes(o: any, opciones: OpcionVariante[] | undefined): VarianteEntrada[] | undefined {
  const l = lista(o, 'variants', MAX_VARIANTES);
  if (!l) return undefined;
  if (!opciones) {
    throw invalido('variants', 'Para mandar `variants` primero define `variant_options` (ej. [{ "name": "Talla", "values": ["S","M"] }]).');
  }
  const vistas = new Set<string>();
  return l.map((x, i) => {
    const p = `variants[${i}]`;
    if (!x || typeof x !== 'object' || !x.attributes || typeof x.attributes !== 'object') {
      throw invalido(`${p}.attributes`, `\`${p}.attributes\` tiene que decir la combinación, ej. { "Talla": "M", "Color": "Negro" }.`);
    }
    const valores: Record<string, string> = {};
    for (const op of opciones) {
      const clave = Object.keys(x.attributes).find((k) => k.trim().toUpperCase() === op.nombre.toUpperCase());
      const v = clave ? String(x.attributes[clave] ?? '').trim() : '';
      if (!v) throw invalido(`${p}.attributes`, `\`${p}.attributes\` no dice ${op.nombre}.`);
      const real = op.valores.find((w) => w.toUpperCase() === v.toUpperCase());
      if (!real) {
        throw invalido(`${p}.attributes`, `${op.nombre} "${v}" no está en variant_options (${op.valores.join(', ')}).`);
      }
      valores[op.nombre] = real;
    }
    const sobra = Object.keys(x.attributes).find((k) => !opciones.some((op) => op.nombre.toUpperCase() === k.trim().toUpperCase()));
    if (sobra) throw invalido(`${p}.attributes`, `"${sobra}" no es una de las opciones (${opciones.map((op) => op.nombre).join(', ')}).`);
    const clave = JSON.stringify(Object.entries(valores).sort());
    if (vistas.has(clave)) throw invalido(p, `La combinación de \`${p}\` ya está en otra variante.`);
    vistas.add(clave);
    const otro = Object.keys(x).find((k) => !['attributes', 'sku', 'barcode', 'price', 'stock', 'image'].includes(k));
    if (otro) throw invalido(`${p}.${otro}`, `\`${p}.${otro}\` no existe. Campos: attributes, sku, barcode, price, stock, image.`, 'unknown_parameter');
    const imagen = texto(x, 'image', 1000, false, `${p}.image`);
    if (imagen && !/^https:\/\/\S+$/i.test(imagen)) throw invalido(`${p}.image`, `\`${p}.image\` tiene que ser una URL https pública de la foto.`);
    return {
      valores,
      codigo: texto(x, 'sku', 60, false, `${p}.sku`) || undefined,
      codigoBarras: texto(x, 'barcode', 60, false, `${p}.barcode`) || undefined,
      precio: monto(x, 'price', { nombre: `${p}.price` }),
      imagen: imagen || undefined,
      stock: monto(x, 'stock', { cero: true, nombre: `${p}.stock` }) ?? 0,
    };
  });
}

const CAMPOS_ALTA = [
  'name', 'price', 'sku', 'barcode', 'description', 'category_id', 'brand_id', 'unit', 'tax', 'currency',
  'sale_price', 'sale_starts_on', 'sale_ends_on', 'published_in_store', 'stock', 'location_id', 'type', 'images', 'cost',
  'wholesale_prices', 'packs', 'pharmacy', 'batch', 'variant_options', 'variants',
];
const CAMPOS_CAMBIO = [
  'name', 'price', 'sku', 'barcode', 'description', 'category_id', 'brand_id', 'sale_price',
  'sale_starts_on', 'sale_ends_on', 'published_in_store', 'images', 'wholesale_prices', 'packs', 'pharmacy',
];

export interface AltaProducto {
  descripcion: string;
  precioUnitario: number;
  codigo?: string;
  codigoBarras?: string;
  descripcionLarga?: string;
  categoriaId?: number;
  marcaId?: number;
  unidad?: string;
  tipoAfectacionIGV: string;
  moneda: 'PEN' | 'USD';
  precioOferta?: number;
  ofertaDesde?: Date | null;
  ofertaHasta?: Date | null;
  publicarEnTienda?: boolean;
  stock: number;
  sedeId?: number;
  esServicio: boolean;
  imagenes?: string[];
  costo?: number;
  preciosMayorista?: { cantidadMinima: number; precio: number }[];
  presentaciones?: { codigo: string; unidadesPorPaquete: number; precioPaquete: number; alias?: string }[];
  farmacia?: Record<string, unknown>;
  lote?: Lote;
  opcionesVariante?: OpcionVariante[];
  variantes?: VarianteEntrada[];
}

export function leerAlta(body: any): AltaProducto {
  soloConocidos(body, CAMPOS_ALTA);
  const tipo = texto(body, 'type', 20) ?? 'product';
  if (tipo !== 'product' && tipo !== 'service') throw invalido('type', '`type` es `product` o `service`.');
  const tax = texto(body, 'tax', 20) ?? 'taxed';
  if (!IMPUESTO_A_AFECTACION[tax]) {
    throw invalido('tax', '`tax` es `taxed` (con IGV), `exempt` (exonerado, p. ej. Ley de Amazonía) o `unaffected` (inafecto).');
  }
  const currency = (texto(body, 'currency', 3) ?? 'PEN').toUpperCase();
  if (currency !== 'PEN' && currency !== 'USD') throw invalido('currency', '`currency` es `PEN` o `USD`.');
  const precio = monto(body, 'price', { requerido: true })!;
  const oferta = monto(body, 'sale_price');
  if (oferta !== undefined && oferta >= precio) {
    throw invalido('sale_price', '`sale_price` es el precio de oferta: tiene que ser menor que `price`.');
  }
  if ((presente(body, 'sale_starts_on') || presente(body, 'sale_ends_on')) && oferta === undefined) {
    throw invalido('sale_price', 'Las fechas de oferta van con `sale_price` (el precio de oferta).');
  }
  const esServicio = tipo === 'service';
  const opciones = opcionesVariante(body);
  const vars = variantes(body, opciones);
  const stock = monto(body, 'stock', { cero: true }) ?? 0;
  const batch = lote(body);
  const packs = presentaciones(body);

  if (esServicio) {
    const conStock = stock > 0 ? 'stock' : batch ? 'batch' : opciones ? 'variant_options' : packs ? 'packs' : null;
    if (conStock) throw invalido(conStock, `Un servicio no tiene ${conStock === 'stock' ? 'stock' : conStock === 'batch' ? 'lotes' : conStock === 'packs' ? 'presentaciones' : 'variantes'}. Si es un bien, manda \`type: "product"\`.`);
  }
  if (opciones && stock > 0) {
    throw invalido('stock', 'Con variantes, el stock va en cada una: `variants[i].stock`. El del producto es la suma.');
  }
  if (opciones && batch) {
    throw invalido('batch', 'Por ahora no se pueden cargar variantes con lote por la API: crea las variantes sin stock y carga el stock de cada una con stock_adjustments.');
  }
  if (batch && !(stock > 0)) {
    throw invalido('stock', 'Con `batch`, manda también `stock`: cuántas unidades entran en ese lote.');
  }

  return {
    descripcion: texto(body, 'name', 250, true)!,
    precioUnitario: precio,
    codigo: texto(body, 'sku', 60) || undefined,
    codigoBarras: texto(body, 'barcode', 60) || undefined,
    descripcionLarga: texto(body, 'description', 5000) || undefined,
    categoriaId: entero(body, 'category_id'),
    marcaId: entero(body, 'brand_id'),
    unidad: (texto(body, 'unit', 10) || undefined)?.toUpperCase(),
    tipoAfectacionIGV: IMPUESTO_A_AFECTACION[tax],
    moneda: currency,
    precioOferta: oferta,
    ...fechasOferta(body),
    publicarEnTienda: booleano(body, 'published_in_store'),
    stock,
    sedeId: entero(body, 'location_id'),
    esServicio,
    imagenes: imagenes(body),
    costo: monto(body, 'cost', { cero: true }),
    preciosMayorista: preciosMayorista(body),
    presentaciones: packs,
    farmacia: farmacia(body),
    lote: batch,
    opcionesVariante: opciones,
    variantes: vars,
  };
}

export interface CambioProducto {
  descripcion?: string;
  precioUnitario?: number;
  codigo?: string;
  codigoBarras?: string;
  descripcionLarga?: string;
  categoriaId?: number | null;
  marcaId?: number | null;
  /** null = quitar la oferta. */
  precioOferta?: number | null;
  ofertaDesde?: Date | null;
  ofertaHasta?: Date | null;
  publicarEnTienda?: boolean;
  imagenes?: string[];
  preciosMayorista?: { cantidadMinima: number; precio: number }[];
  presentaciones?: { codigo: string; unidadesPorPaquete: number; precioPaquete: number; alias?: string }[];
  farmacia?: Record<string, unknown>;
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
    marcaId: presente(body, 'brand_id') ? (body.brand_id === null ? null : entero(body, 'brand_id')) : undefined,
    precioOferta: presente(body, 'sale_price') ? (body.sale_price === null ? null : monto(body, 'sale_price')) : undefined,
    publicarEnTienda: booleano(body, 'published_in_store'),
    ...fechasOferta(body),
    imagenes: imagenes(body),
    preciosMayorista: presente(body, 'wholesale_prices') ? (preciosMayorista(body) ?? []) : undefined,
    presentaciones: presente(body, 'packs') ? (presentaciones(body) ?? []) : undefined,
    farmacia: farmacia(body),
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
  lote?: Lote;
}

export function leerAjuste(body: any): AjusteStock {
  soloConocidos(body, ['location_id', 'quantity', 'change', 'reason', 'note', 'batch']);
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
  const batch = lote(body);
  if (batch && tieneQuantity) {
    throw invalido('quantity', 'Con `batch`, usa `change` (cuánto entra o sale de ese lote), no `quantity`.');
  }
  return {
    sedeId: entero(body, 'location_id'),
    nuevo: tieneQuantity ? monto(body, 'quantity', { cero: true }) : undefined,
    cambio,
    motivo: MOTIVOS_AJUSTE[reason],
    razon: reason,
    nota: texto(body, 'note', 300) || undefined,
    lote: batch,
  };
}
