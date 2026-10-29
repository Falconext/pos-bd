import { BadRequestException } from '@nestjs/common';

/**
 * Guía de remisión con motivo 04 (traslado entre establecimientos de la misma
 * empresa) que además mueve el inventario entre dos sedes propias.
 *
 * Regla: el stock se mueve al CREAR la guía y vuelve solo si la guía se
 * ELIMINA. Una guía rechazada por SUNAT se corrige y reenvía, así que mientras
 * exista el traslado sigue hecho. Editar una guía no enviada recalcula el
 * movimiento (devuelve lo anterior y aplica lo nuevo).
 *
 * Sin las dos sedes la guía no toca el inventario: sirve igual para llevar
 * mercadería a un local que no está registrado como sede.
 */

export const MOTIVO_TRASLADO_ENTRE_SEDES = '04';

export interface GuiaConSedes {
  tipoTraslado?: string | null;
  sedeOrigenId?: number | null;
  sedeDestinoId?: number | null;
}

export interface DetalleTrasladable {
  productoId?: number | null;
  cantidad: unknown;
  descripcion?: string | null;
}

export function esTrasladoEntreSedes(g: GuiaConSedes): boolean {
  return (
    String(g.tipoTraslado ?? '') === MOTIVO_TRASLADO_ENTRE_SEDES &&
    Number(g.sedeOrigenId) > 0 &&
    Number(g.sedeDestinoId) > 0
  );
}

/**
 * Ítems de inventario a mover. Cada línea tiene que ser un producto del
 * catálogo (un ítem libre no tiene stock que mover); las líneas repetidas del
 * mismo producto se suman.
 */
export function itemsDelTraslado(
  detalles: DetalleTrasladable[],
): { productoId: number; cantidad: number }[] {
  const porProducto = new Map<number, number>();
  for (const d of detalles ?? []) {
    const productoId = Number(d.productoId);
    if (!(productoId > 0)) {
      throw new BadRequestException(
        `"${d.descripcion || 'Ítem sin producto'}" no es un producto del inventario: en un traslado entre sedes todos los ítems deben elegirse del catálogo para mover su stock.`,
      );
    }
    const cantidad = Number(d.cantidad);
    if (!(cantidad > 0)) {
      throw new BadRequestException(
        `La cantidad de "${d.descripcion || productoId}" debe ser mayor a 0.`,
      );
    }
    porProducto.set(productoId, round3((porProducto.get(productoId) ?? 0) + cantidad));
  }
  if (!porProducto.size) {
    throw new BadRequestException('La guía de traslado no tiene productos que mover.');
  }
  return [...porProducto.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([productoId, cantidad]) => ({ productoId, cantidad }));
}

/** `Sede.codigo` es el anexo SUNAT solo si son 4 dígitos (p. ej. 0000, 0001). */
export function esAnexoSunat(codigo?: string | null): boolean {
  return /^\d{4}$/.test(String(codigo ?? '').trim());
}

/** Firma del movimiento: si no cambia al editar, no se toca el stock. */
export function firmaTraslado(
  g: GuiaConSedes,
  detalles: DetalleTrasladable[],
): string | null {
  if (!esTrasladoEntreSedes(g)) return null;
  return JSON.stringify({
    o: Number(g.sedeOrigenId),
    d: Number(g.sedeDestinoId),
    i: itemsDelTraslado(detalles),
  });
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
