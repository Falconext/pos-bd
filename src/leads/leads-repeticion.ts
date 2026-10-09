/**
 * A3 — que el asistente no se repita ni insista después de la despedida.
 *
 * Dos cosas distintas que el banco de pruebas de Hierba Sana castiga:
 *  - mandar otra vez lo mismo con otras palabras ("Quedo atento para ayudarte
 *    a completar tu pedido 😊" / "Estoy aquí para ayudarte a finalizar tu
 *    compra 😊"): misma función comunicativa, cero información nueva;
 *  - seguir vendiendo después de que el cliente se despidió.
 *
 * Aquí viven las reglas puras. El embedding y la escritura en base de datos
 * los pone el processor.
 */

/**
 * Umbral de parecido entre dos respuestas nuestras. Por encima se considera
 * que cumplen la misma función y no se repite la segunda. Lo fija el propio
 * cliente en su flujo V20.2 ("similitud igual o superior al 80%").
 */
export const UMBRAL_REPETICION = 0.8;

/** Cuántas respuestas nuestras se miran hacia atrás. */
export const RESPUESTAS_A_COMPARAR = 5;

/**
 * Texto comparable: sin mayúsculas, sin tildes, sin emojis ni puntuación.
 * Se quitan las tildes antes de filtrar por ASCII para que "información" o
 * "año" sobrevivan al filtro.
 */
export function normalizar(texto: string): string {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cortesía o confirmación breve: "gracias", "ok", "listo", un emoji suelto.
 * No aporta información nueva, pero —ojo— tampoco es una despedida: el flujo
 * del cliente es explícito en que un "gracias" nunca cierra la conversación.
 */
const CORTESIAS = new Set([
  'gracias',
  'muchas gracias',
  'mil gracias',
  'gracias gracias',
  'ok',
  'oka',
  'okey',
  'okay',
  'ok gracias',
  'gracias ok',
  'listo',
  'ya',
  'ya esta',
  'perfecto',
  'bien',
  'muy bien',
  'genial',
  'excelente',
  'buenisimo',
  'entendido',
  'de acuerdo',
  'bueno',
]);

export function esCortesiaBreve(texto: string): boolean {
  const limpio = normalizar(texto);
  // Un mensaje de puros emojis se queda vacío al normalizar.
  if (!limpio) return true;
  if (limpio.split(' ').length > 4) return false;
  return CORTESIAS.has(limpio);
}

/**
 * Despedidas inequívocas. Deliberadamente NO incluye "lo voy a pensar" ni
 * "después te aviso": eso es una venta en pausa, no una cerrada, y el banco de
 * pruebas espera que se recupere más tarde, no que se cierre.
 */
const DESPEDIDAS = [
  'gracias por la informacion',
  'gracias por la info',
  'no gracias',
  'no por ahora',
  'por ahora no',
  'ya no',
  'eso es todo',
  'eso seria todo',
  'nada mas',
  'hasta luego',
  'nos vemos',
  'chau',
  'adios',
  'no me interesa',
  'solo preguntaba',
  'solo queria saber',
  'ya compre',
  'ya consegui',
];

export function esDespedidaClara(texto: string): boolean {
  const limpio = normalizar(texto);
  if (!limpio) return false;
  // En un mensaje largo esas palabras suelen ser parte de otra cosa
  // ("ya no me acuerdo cuál pedí la vez pasada").
  if (limpio.split(' ').length > 8) return false;
  return DESPEDIDAS.some((d) => limpio.includes(d));
}

/** Coseno entre dos vectores. 0 si alguno está vacío o no coinciden en tamaño. */
export function similitudCoseno(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let producto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < a.length; i++) {
    producto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  if (normaA === 0 || normaB === 0) return 0;
  return producto / (Math.sqrt(normaA) * Math.sqrt(normaB));
}

/** ¿Se parece demasiado a alguna de las respuestas recientes? */
export function esRepetida(
  embedding: number[],
  anteriores: number[][],
  umbral = UMBRAL_REPETICION,
): boolean {
  return anteriores.some((v) => similitudCoseno(embedding, v) >= umbral);
}
