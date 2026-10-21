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
  // Descontinuado: distinto de agotado. Agotado puede volver; esto no, y por
  // eso no genera lista de espera.
  'no comercial': 'NO_COMERCIAL',
  descontinuado: 'NO_COMERCIAL',
  discontinuado: 'NO_COMERCIAL',
  'ya no se vende': 'NO_COMERCIAL',
  'fuera de catalogo': 'NO_COMERCIAL',
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

/**
 * Cuatro niveles, como los pidió el negocio. Antes eran tres y "baja" no
 * existía: un producto que se quiere mover poco quedaba igual que uno sin
 * preferencia.
 */
const PRIORIDADES: Record<string, number> = {
  'muy alta': 4,
  alta: 3,
  media: 2,
  normal: 2,
  baja: 1,
  '4': 4,
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
  if (prioridad === 4) return 'MUY ALTA';
  if (prioridad === 3) return 'ALTA';
  if (prioridad === 2) return 'MEDIA';
  if (prioridad === 1) return 'BAJA';
  return '';
}

/**
 * Cuánto se recomienda el producto, en palabras, para la IA. Es la misma
 * escala de cuatro niveles del Excel y de la ficha.
 *
 * Antes la IA la leía con la escala vieja de tres: "media" le llegaba como
 * "alta" y "muy alta" como menos que "alta" (20-10).
 */
export function nivelDeRecomendacion(
  prioridad: number | null | undefined,
): string | null {
  const texto = escribirPrioridadVenta(Number(prioridad) || null);
  return texto ? texto.toLowerCase() : null;
}

/**
 * El valor de una columna del Excel sin importar mayúsculas, tildes ni
 * espacios del encabezado. El catálogo de Hierba Sana traía "Prioridad de
 * venta" y el importador solo buscaba "PRIORIDAD DE VENTA": la columna entera
 * se perdía sin aviso.
 */
export function valorDeColumna(
  fila: Record<string, unknown>,
  nombres: string[],
): unknown {
  const buscados = new Set(nombres.map(normalizar));
  for (const [clave, valor] of Object.entries(fila)) {
    if (buscados.has(normalizar(clave))) return valor;
  }
  return undefined;
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
      // Se pide al proveedor solo para este cliente: sin un pago previo, si
      // no lo compra el producto se queda en el local (Hierba Sana, 20-10).
      return '🕐 bajo reserva: lo conseguimos para el cliente, sin fecha prometida. Para pedirlo tiene que pagar antes al menos la reserva (o el adelanto si es de provincia), según las reglas de pago del negocio. Díselo al ofrecerlo y no lo registres sin ese pago';
    case 'NO_DISPONIBLE':
      return 'agotado: no lo ofrezcas. Si el cliente pregunta por él, dile que por ahora no hay y que le avisamos cuando vuelva';
    case 'NO_COMERCIAL':
      // Distinto de agotado: no va a volver, así que no se puede prometer
      // aviso. Mejor decirlo y ofrecer otra cosa que dejar al cliente esperando.
      return 'descontinuado: ya no se vende, se retira del catálogo porque salió del mercado. No lo ofrezcas ni prometas avisar cuando vuelva; si lo pide, avísale que se retiró y ofrece una alternativa';
  }
}
