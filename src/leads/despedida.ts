/**
 * Mensaje de despedida al cerrar una conversación.
 *
 * Hierba Sana (26-10) lo pidió con su texto: "¡Un gusto ayudarte! … guarda
 * nuestro número … síguenos en Facebook", más el link del catálogo. Sale en
 * tres casos que ellos definieron:
 *
 *  1. Venta cerrada: ya tiene su pedido agendado y dejó de escribir.
 *  2. "Lo consulto con mi médico / con mi familia": la compra quedó en pausa.
 *  3. Se le mandó el reenganche y a las 2 horas no contestó.
 *
 * El texto lo escribe el negocio en "Mi vendedor" y se manda tal cual: es
 * un mensaje de marca, no algo que la IA deba redactar a su manera.
 *
 * Una sola vez por silencio: el contador `seguimientos` queda en
 * YA_SE_DESPIDIO y vuelve a 0 cuando el cliente escribe. Sale como texto
 * libre, así que solo dentro de las 24 h desde el último mensaje del
 * cliente; fuera de esa ventana WhatsApp exigiría una plantilla aprobada, y
 * una despedida no vale lo que cuesta una plantilla de marketing.
 */

export interface ConfigDespedida {
  activa: boolean;
  texto: string;
}

/** `seguimientos` después de despedirse: ni reenganche ni otra despedida. */
export const YA_SE_DESPIDIO = 2;

/** Horas que se espera al reenganche sin respuesta antes de despedirse. */
export const HORAS_TRAS_REENGANCHE = 2;

const LARGO_MAXIMO = 1000;

/** Lo guardado en iaVentasConfigJson, saneado. Siempre devuelve algo. */
export function despedidaValida(raw: unknown): ConfigDespedida {
  const d = (raw ?? {}) as { activa?: unknown; texto?: unknown };
  const texto = typeof d.texto === 'string' ? d.texto.trim().slice(0, LARGO_MAXIMO) : '';
  return { activa: d.activa === true && texto.length > 0, texto };
}

/** El texto a mandar, o null si el negocio no la tiene encendida. */
export function textoDespedida(configJson: unknown): string | null {
  const cfg = despedidaValida((configJson as { despedida?: unknown } | null)?.despedida);
  return cfg.activa ? cfg.texto : null;
}

/**
 * Motivos de `motivoParaNoReenganchar` en los que corresponde despedirse en
 * vez de solo callarse. Los otros (aviso programado, demo recién dada) ya
 * tienen su propio mensaje en camino y una despedida lo contradiría.
 */
const MOTIVOS_CON_DESPEDIDA = new Set([
  'ya agendó su pedido',
  'dijo que avisaba o que escribía después',
]);

export function despedirsePorMotivo(motivo: string | null): boolean {
  return motivo != null && MOTIVOS_CON_DESPEDIDA.has(motivo);
}
