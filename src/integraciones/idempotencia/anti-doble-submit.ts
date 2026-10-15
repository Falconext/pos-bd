/**
 * Cuándo conviene el heurístico anti-doble-submit, y cuándo estorba.
 *
 * `assertNoDobleSubmitReciente` rechaza un comprobante idéntico —mismo
 * cliente, sede, usuario, tipo y monto— emitido en los últimos segundos. En
 * el panel acierta casi siempre: ahí un duplicado así es un doble clic.
 *
 * En una API es DAÑINO. Dos ventas reales iguales seguidas son normales: dos
 * cafés al mismo cliente por el mismo monto, dos recargas idénticas, dos
 * pedidos de un mismo ítem. El heurístico las rechazaría, y el integrador
 * recibiría un error por una venta legítima que sí quiere emitir.
 *
 * La salida no es apagarlo: es apagarlo SOLO cuando hay algo mejor. El sync
 * offline ya tenía esa excepción (es idempotente por uuid) y la API la gana
 * al traer `Idempotency-Key`: ahí el integrador dice explícitamente cuándo es
 * la misma operación y cuándo es otra, que es exactamente lo que el
 * heurístico estaba adivinando.
 */
export interface OrigenDeLaEmision {
  /** uuid de la operación offline que la originó. */
  origenSyncUuid?: string | null;
  /** Clave de idempotencia de la API, si vino por ahí. */
  claveIdempotencia?: string | null;
  /** Sin cliente no hay con qué comparar. */
  clienteId?: number | null;
}

/**
 * ¿Hay que correr el heurístico?
 *
 * Solo cuando no existe una garantía mejor. Devuelve `false` apenas hay una,
 * porque adivinar al lado de una certeza solo puede equivocarse.
 */
export function debeRevisarDobleSubmit(origen: OrigenDeLaEmision): boolean {
  if (origen.origenSyncUuid) return false;
  if (typeof origen.claveIdempotencia === 'string' && origen.claveIdempotencia.trim()) {
    return false;
  }
  return Number(origen.clienteId) > 0;
}
