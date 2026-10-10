/**
 * B1 y B2 — disponibilidad y prioridad de venta: cómo se leen del Excel y cómo
 * se le cuentan al cliente.
 *
 * El empresario no escribe enums. En la columna pone "BAJO PEDIDO", "bajo
 * pedido", "Muy Alta" o "3", y el importador tiene que entenderlo igual. Estas
 * funciones son puras para poder probar esas variantes sin levantar nada.
 */
import { DisponibilidadProducto } from '@prisma/client';

/** Texto comparable: sin tildes, sin mayúsculas, sin guiones ni dobles espacios. */
function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DISPONIBILIDADES: Record<string, DisponibilidadProducto> = {
  inmediata: 'INMEDIATA',
  inmediato: 'INMEDIATA',
  disponible: 'INMEDIATA',
  si: 'INMEDIATA',
  'en stock': 'INMEDIATA',
  'bajo pedido': 'BAJO_PEDIDO',
  'bajo reserva': 'BAJO_PEDIDO',
  'por encargo': 'BAJO_PEDIDO',
  encargo: 'BAJO_PEDIDO',
  'no disponible': 'NO_DISPONIBLE',
  agotado: 'NO_DISPONIBLE',
  'sin stock': 'NO_DISPONIBLE',
  no: 'NO_DISPONIBLE',
};

/**
 * Lee la columna DISPONIBILIDAD del Excel. `null` cuando viene vacía o no se
 * reconoce: el producto se queda sin valor explícito y la disponibilidad se
 * deduce del stock, que es el comportamiento de siempre.
 */
export function leerDisponibilidad(
  valor: unknown,
): DisponibilidadProducto | null {
  const limpio = normalizar(valor);
  if (!limpio) return null;
  return DISPONIBILIDADES[limpio] ?? null;
}

const PRIORIDADES: Record<string, number> = {
  'muy alta': 3,
  alta: 2,
  media: 1,
  normal: 1,
  '3': 3,
  '2': 2,
  '1': 1,
};

/**
 * Lee la columna PRIORIDAD. Acepta palabras o el número directo. `null` si
 * viene vacía o fuera de rango: sin prioridad, el producto se ordena por
 * relevancia como cualquier otro.
 */
export function leerPrioridadVenta(valor: unknown): number | null {
  const limpio = normalizar(valor);
  if (!limpio) return null;
  const prioridad = PRIORIDADES[limpio];
  return prioridad ?? null;
}

/** Cómo se escribe de vuelta en el Excel exportado (ida y vuelta sin pérdida). */
export function escribirPrioridadVenta(prioridad: number | null): string {
  if (prioridad === 3) return 'MUY ALTA';
  if (prioridad === 2) return 'ALTA';
  if (prioridad === 1) return 'MEDIA';
  return '';
}

/**
 * La disponibilidad efectiva de un producto. Si no se fijó a mano, se deduce
 * del stock: quien lleva inventario real no tiene que mantener dos campos en
 * sincronía.
 */
export function disponibilidadEfectiva(producto: {
  disponibilidad?: DisponibilidadProducto | null;
  stock?: unknown;
}): DisponibilidadProducto {
  if (producto.disponibilidad) return producto.disponibilidad;
  return Number(producto.stock ?? 0) > 0 ? 'INMEDIATA' : 'NO_DISPONIBLE';
}

/**
 * Lo que la IA le dice al cliente. Nunca un número de stock: para un negocio
 * sin inventario real ese número es ficticio, y decir "quedan 50" cuando no se
 * sabe es una promesa que no se puede cumplir.
 *
 * Los textos salen del prompt del cliente (AGENTE_01.txt).
 */
export function textoParaElCliente(
  disponibilidad: DisponibilidadProducto,
): string {
  switch (disponibilidad) {
    case 'INMEDIATA':
      return '✅ disponible';
    case 'BAJO_PEDIDO':
      return '🕐 bajo pedido: lo conseguimos y confirmamos la disponibilidad antes de despachar, sin fecha prometida';
    case 'NO_DISPONIBLE':
      return 'no disponible: no lo ofrezcas';
  }
}
