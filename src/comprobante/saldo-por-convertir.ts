/**
 * Lo que falta convertir de una nota que se facturó solo en parte.
 *
 * El POS deja convertir una nota de venta quitando productos (la clienta quiere
 * una parte con factura y otra con boleta). Pero apenas existía un formal que
 * apuntaba a la nota, el sistema la daba por convertida y bloqueaba cualquier
 * otra conversión: el resto quedaba sin poder emitirse por ningún lado, y emitirlo
 * como venta suelta descontaba stock y cobraba otra vez. (IRBA, NV01-1 → F0A1-1
 * con 3 de 5 productos; la boleta por los otros 2 no salía.)
 *
 * Regla: la nota admite más conversiones mientras le queden cantidades sin
 * emitir, y cada una solo puede llevar lo que queda.
 *
 * Vive aparte del servicio para poder probarse sin Prisma.
 */

export interface LineaNota {
  productoId?: number | null;
  comboId?: number | null;
  descripcion?: string | null;
  cantidad: number | string;
  [k: string]: any;
}

const EPS = 1e-6;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Qué línea es "la misma" entre la nota y sus formales. El producto manda: al
 * convertir se puede retocar la descripción. Sin producto (ítem libre), la
 * descripción es lo único que hay. Un kit de una sola línea se distingue por
 * su combo.
 */
export const claveLinea = (l: LineaNota): string => {
  const pid = Number(l.productoId ?? 0);
  if (pid > 0) return `p:${pid}`;
  const combo = Number(l.comboId ?? 0);
  if (combo > 0) return `k:${combo}`;
  return `d:${String(l.descripcion ?? '').trim().toUpperCase()}`;
};

// Montos de línea que escalan con la cantidad. Los unitarios no cambian.
const MONTOS_DE_LINEA = ['mtoValorVenta', 'mtoBaseIgv', 'igv', 'totalImpuestos', 'mtoDescuento'];

/**
 * Las líneas de la nota con la cantidad que todavía no salió en ningún formal.
 * Si una misma clave aparece en varias líneas de la nota, lo emitido se
 * descuenta en orden. Los montos de la línea se escalan a la cantidad que queda.
 */
export function lineasPorConvertir<T extends LineaNota>(nota: T[], emitidas: LineaNota[]): T[] {
  const consumido = new Map<string, number>();
  for (const e of emitidas) {
    const k = claveLinea(e);
    consumido.set(k, (consumido.get(k) ?? 0) + Number(e.cantidad || 0));
  }

  const pendientes: T[] = [];
  for (const linea of nota) {
    const k = claveLinea(linea);
    const cantidad = Number(linea.cantidad || 0);
    const usado = Math.min(cantidad, consumido.get(k) ?? 0);
    consumido.set(k, (consumido.get(k) ?? 0) - usado);
    const queda = cantidad - usado;
    if (queda <= EPS) continue;
    if (usado <= EPS) {
      pendientes.push(linea);
      continue;
    }
    const factor = queda / cantidad;
    const escalada: any = { ...linea, cantidad: queda };
    for (const campo of MONTOS_DE_LINEA) {
      if (escalada[campo] != null) escalada[campo] = r2(Number(escalada[campo]) * factor);
    }
    pendientes.push(escalada);
  }
  return pendientes;
}

/** Total con IGV de las líneas pendientes (lo que vale el saldo). */
export const totalDeLineas = (lineas: LineaNota[]): number =>
  r2(
    lineas.reduce((acc, l: any) => {
      const conIgv = Number(l.mtoValorVenta ?? 0) + Number(l.igv ?? 0);
      return acc + (conIgv > 0 ? conIgv : Number(l.mtoPrecioUnitario ?? 0) * Number(l.cantidad ?? 0));
    }, 0),
  );

/**
 * Qué líneas de la nueva conversión no caben en lo que falta. Vacío = todo
 * cabe. Cada texto nombra el producto y cuánto queda, para que el mensaje
 * diga qué corregir.
 */
export function excesosSobreSaldo(pendientes: LineaNota[], nuevas: LineaNota[]): string[] {
  const disponible = new Map<string, { cantidad: number; descripcion: string }>();
  for (const p of pendientes) {
    const k = claveLinea(p);
    const prev = disponible.get(k);
    disponible.set(k, {
      cantidad: (prev?.cantidad ?? 0) + Number(p.cantidad || 0),
      descripcion: prev?.descripcion ?? String(p.descripcion ?? '').trim(),
    });
  }
  const pedido = new Map<string, { cantidad: number; descripcion: string }>();
  for (const n of nuevas) {
    const k = claveLinea(n);
    const prev = pedido.get(k);
    pedido.set(k, {
      cantidad: (prev?.cantidad ?? 0) + Number(n.cantidad || 0),
      descripcion: prev?.descripcion ?? String(n.descripcion ?? '').trim(),
    });
  }
  const excesos: string[] = [];
  for (const [k, p] of pedido) {
    const queda = disponible.get(k)?.cantidad ?? 0;
    if (p.cantidad > queda + EPS) {
      excesos.push(
        queda <= EPS
          ? `${p.descripcion}: ya no queda por convertir`
          : `${p.descripcion}: quedan ${Number(queda.toFixed(4))}, se pidió ${Number(p.cantidad.toFixed(4))}`,
      );
    }
  }
  return excesos;
}
