/**
 * Resumen diario de stock bajo: la parte que no toca la base ni la red.
 *
 * El pedido (tienda de regalos, 2026-10-19): "pongo que si tiene menos de 10
 * unidades me avise, pero no hay una alerta… tengo que entrar, descargar el
 * Excel y sacar cuáles están bajos para armar la lista de compras". La
 * campana del panel ya avisaba, pero solo a quien entra al panel. Esto arma la
 * lista que le llega sola por correo y por WhatsApp.
 */

export interface FilaStockSede {
  productoId: number;
  codigo: string | null;
  descripcion: string;
  sedeId: number;
  sedeNombre: string;
  stock: number;
  /** Mínimo propio de la sede (ProductoStock.stockMinimo). */
  minimoSede: number | null;
  /** Mínimo del producto (Producto.stockMinimo), si la sede no tiene uno. */
  minimoProducto: number | null;
}

export interface ProductoStockBajo {
  productoId: number;
  codigo: string | null;
  descripcion: string;
  sedeId: number;
  sedeNombre: string;
  stock: number;
  minimo: number;
  /** Unidades que faltan para volver al mínimo. */
  faltan: number;
  agotado: boolean;
}

/**
 * Qué productos están en su mínimo o por debajo, por sede.
 *
 * Un producto sin mínimo (0 o vacío) no entra aunque esté en cero: el negocio
 * no pidió que lo vigilen, y así quedan fuera los servicios, que no llevan
 * stock. El mínimo de la sede manda; si la sede no tiene uno, el del producto.
 *
 * Orden: agotados primero, después los que están más lejos de su mínimo
 * (proporcionalmente), así lo urgente encabeza el correo y el WhatsApp.
 */
export function productosStockBajo(
  filas: FilaStockSede[],
  /**
   * ¿El producto se movió alguna vez en esa sede? Con el catálogo compartido
   * cada producto nuevo nace en TODAS las sedes con stock 0 y el mínimo
   * copiado: sin esto, una sede recién abierta salía con el catálogo entero
   * "agotado". Un producto en cero cuenta solo si alguna vez tuvo movimiento
   * ahí (se vendió, se compró, se ajustó): eso sí es quedarse sin stock.
   */
  seMovioEnSede: (productoId: number, sedeId: number) => boolean = () => true,
): ProductoStockBajo[] {
  const salida: ProductoStockBajo[] = [];
  for (const f of filas) {
    const minimoSede = Number(f.minimoSede) || 0;
    const minimo = minimoSede > 0 ? minimoSede : Number(f.minimoProducto) || 0;
    if (minimo <= 0) continue;
    const stock = redondear(Number(f.stock) || 0);
    if (stock > minimo) continue;
    if (stock <= 0 && !seMovioEnSede(f.productoId, f.sedeId)) continue;
    salida.push({
      productoId: f.productoId,
      codigo: f.codigo,
      descripcion: f.descripcion,
      sedeId: f.sedeId,
      sedeNombre: f.sedeNombre,
      stock,
      minimo,
      faltan: redondear(Math.max(0, minimo - stock)),
      agotado: stock <= 0,
    });
  }
  return salida.sort((a, b) => {
    if (a.agotado !== b.agotado) return a.agotado ? -1 : 1;
    const ra = a.stock / a.minimo;
    const rb = b.stock / b.minimo;
    if (ra !== rb) return ra - rb;
    return a.descripcion.localeCompare(b.descripcion, 'es');
  });
}

/** "Peluche oso (0), Papel coreano (3)" — para la plantilla de WhatsApp. */
export function masUrgentes(productos: ProductoStockBajo[], cuantos = 3): string {
  const lista = productos
    .slice(0, cuantos)
    .map((p) => `${p.descripcion} (${formatoCantidad(p.stock)})`)
    .join(', ');
  const resto = productos.length - cuantos;
  return resto > 0 ? `${lista} y ${resto} más` : lista;
}

/**
 * Mensaje de WhatsApp con la lista. Con varias sedes se agrupa por sede, que
 * es como se repone (cada tienda pide lo suyo). Se corta en 30 líneas: un
 * WhatsApp más largo no se lee, y la lista completa va en el correo.
 */
export function textoWhatsApp(
  negocio: string,
  productos: ProductoStockBajo[],
  panelUrl: string,
): string {
  const MAX = 30;
  const variasSedes = new Set(productos.map((p) => p.sedeId)).size > 1;
  const lineas: string[] = [
    `📦 *Stock bajo · ${negocio}*`,
    '',
    `${productos.length} ${productos.length === 1 ? 'producto está' : 'productos están'} en su mínimo o por debajo:`,
  ];
  let sedeActual: number | null = null;
  for (const p of productos.slice(0, MAX)) {
    if (variasSedes && p.sedeId !== sedeActual) {
      sedeActual = p.sedeId;
      lineas.push('', `🏬 *${p.sedeNombre}*`);
    }
    const marca = p.agotado ? '🔴' : '🟠';
    lineas.push(
      `${marca} ${p.descripcion}: ${formatoCantidad(p.stock)} (mín. ${p.minimo})`,
    );
  }
  if (productos.length > MAX) {
    lineas.push('', `…y ${productos.length - MAX} más. La lista completa está en tu correo.`);
  }
  lineas.push('', `Ver en el panel: ${panelUrl}`);
  return lineas.join('\n');
}

/**
 * Agrupa por sede para el correo y el Excel, conservando el orden de urgencia
 * dentro de cada sede. Las sedes salen por nombre.
 */
export function agruparPorSede(
  productos: ProductoStockBajo[],
): { sedeId: number; sedeNombre: string; productos: ProductoStockBajo[] }[] {
  const grupos = new Map<number, { sedeId: number; sedeNombre: string; productos: ProductoStockBajo[] }>();
  for (const p of productos) {
    const g = grupos.get(p.sedeId) ?? { sedeId: p.sedeId, sedeNombre: p.sedeNombre, productos: [] };
    g.productos.push(p);
    grupos.set(p.sedeId, g);
  }
  return [...grupos.values()].sort((a, b) => a.sedeNombre.localeCompare(b.sedeNombre, 'es'));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lee la lista de correos que escribió el negocio ("a@x.com, b@y.com" o uno
 * por línea). Devuelve los válidos sin repetir y los que no se entienden, para
 * decírselo al guardar en vez de que el correo se pierda callado.
 */
export function leerCorreos(texto: string | null | undefined): { validos: string[]; invalidos: string[] } {
  const partes = String(texto ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const validos: string[] = [];
  const invalidos: string[] = [];
  for (const p of partes) {
    if (!EMAIL_RE.test(p)) invalidos.push(p);
    else if (!validos.includes(p)) validos.push(p);
  }
  return { validos, invalidos };
}

/**
 * Celular peruano a formato internacional (51 + 9 dígitos). Devuelve null si
 * no parece un celular: mejor avisar al guardar que mandar a un número malo.
 */
export function normalizarCelular(texto: string | null | undefined): string | null {
  let d = String(texto ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 9 && d.startsWith('9')) d = `51${d}`;
  if (d.length === 11 && d.startsWith('519')) return d;
  // Número de otro país escrito con su código: se respeta tal cual.
  if (!d.startsWith('51') && d.length >= 10 && d.length <= 15) return d;
  return null;
}

/** Día calendario en Lima (UTC-5, sin horario de verano) como "YYYY-MM-DD". */
export function diaLima(fecha: Date): string {
  return new Date(fecha.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}

/** ¿Ya salió el resumen hoy (hora de Lima)? */
export function yaSalioHoy(ultimoEnvio: Date | null | undefined, ahora: Date): boolean {
  return !!ultimoEnvio && diaLima(ultimoEnvio) === diaLima(ahora);
}

export function formatoCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function redondear(n: number): number {
  return Math.round(n * 1000) / 1000;
}
