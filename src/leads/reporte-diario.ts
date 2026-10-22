/**
 * Reporte diario por WhatsApp al dueño (pedido 2026-10-21, del webinar de
 * Yavendió: "te manda cómo te fue cada día").
 *
 * Sale a las 9 p. m. desde el número de Krezka, solo a negocios con IA de
 * Ventas que lo activaron. Esta parte arma el mensaje; no toca la base.
 */

/** Plantilla en la WABA de Krezka, para cuando la ventana de 24 h está cerrada. */
export const PLANTILLA_RESUMEN_DIA = 'resumen_del_dia';

/** La empresa dueña del número de Krezka. */
export const empresaKrezkaId = () =>
  Number(process.env.KREZKA_WHATSAPP_EMPRESA_ID) || 22;

export interface DatosReporte {
  negocio: string;
  /** "YYYY-MM-DD" en Lima. */
  fecha: string;
  vendido: number;
  ventas: number;
  vendidoAyer: number;
  top: { descripcion: string; cantidad: number }[];
  chat: {
    conversacionesNuevas: number;
    pedidos: number;
    vendidoPorChat: number;
    esperandoPersona: number;
  };
  porDespachar: number;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const soles = (n: number) =>
  `S/ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "miércoles 21/10" */
export function diaLegible(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const dia = DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
  return `${dia} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/**
 * Cómo le fue respecto de ayer. Sin ventas ayer no hay porcentaje: "+100%"
 * o "∞" no le dicen nada al dueño.
 */
export function comparacionConAyer(hoy: number, ayer: number): string | null {
  if (!ayer || ayer <= 0) return null;
  const pct = Math.round(((hoy - ayer) / ayer) * 100);
  if (pct === 0) return `igual que ayer (${soles(ayer)})`;
  return `${pct > 0 ? '+' : ''}${pct}% vs. ayer (${soles(ayer)})`;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * El mensaje, en dos formas que dicen lo mismo: texto libre (si el dueño le
 * escribió a Krezka en las últimas 24 h) y los parámetros de la plantilla
 * (si no). Los parámetros de plantilla no admiten saltos de línea, por eso
 * el resto va en una sola frase.
 */
export function armarReporte(d: DatosReporte): { texto: string; parametros: string[] } {
  const comparacion = comparacionConAyer(d.vendido, d.vendidoAyer);
  const top = d.top.filter((t) => t.cantidad > 0).slice(0, 3);

  const lineas: (string | null)[] = [
    `📊 *Resumen de hoy, ${diaLegible(d.fecha)}*`,
    `_${d.negocio}_`,
    '',
    d.ventas > 0
      ? `💰 Vendiste *${soles(d.vendido)}* en ${plural(d.ventas, 'venta', 'ventas')}`
      : '💰 Hoy no se registraron ventas',
    comparacion ? `   ${comparacion}` : null,
    top.length
      ? `🏆 Lo que más salió: ${top.map((t) => `${corto(t.descripcion)} (${formatoCantidad(t.cantidad)})`).join(', ')}`
      : null,
    lineaChat(d),
    d.chat.esperandoPersona > 0
      ? `🙋 ${plural(d.chat.esperandoPersona, 'chat espera', 'chats esperan')} que alguien del equipo responda`
      : null,
    d.porDespachar > 0
      ? `📦 ${plural(d.porDespachar, 'pedido', 'pedidos')} por despachar`
      : null,
    '',
    'Detalle en tu panel de Krezka.',
  ];
  const texto = lineas.filter((l) => l !== null).join('\n');

  // {{4}}: lo demás en una frase. Nunca vacío: Meta rechaza un parámetro
  // vacío y el mensaje entero no sale.
  const extras = [
    comparacion ? comparacion.replace(/^\+/, 'subiste ') : null,
    top[0] ? `lo que más salió: ${corto(top[0].descripcion)}` : null,
    d.chat.conversacionesNuevas > 0
      ? `${plural(d.chat.conversacionesNuevas, 'persona nueva', 'personas nuevas')} por WhatsApp`
      : null,
    d.chat.esperandoPersona > 0 ? `${d.chat.esperandoPersona} por responder` : null,
    d.porDespachar > 0 ? `${d.porDespachar} por despachar` : null,
  ].filter(Boolean) as string[];

  return {
    texto,
    parametros: [
      paraParametro(d.negocio),
      soles(d.vendido),
      String(d.ventas),
      paraParametro(extras.join(' · ')),
    ],
  };
}

/** Un nombre de producto largo alarga la línea hasta volverla ilegible en el celular. */
const corto = (v: string, max = 40) => (v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v);

function lineaChat(d: DatosReporte): string {
  const { conversacionesNuevas: nuevas, pedidos, vendidoPorChat } = d.chat;
  const compras =
    pedidos > 0 ? `${plural(pedidos, 'compró', 'compraron')} por el chat (${soles(vendidoPorChat)})` : '';
  if (nuevas === 0) {
    return compras ? `💬 Por WhatsApp: ${compras}` : '💬 Hoy nadie nuevo te escribió por WhatsApp';
  }
  return `💬 Te escribieron ${plural(nuevas, 'persona nueva', 'personas nuevas')} por WhatsApp${compras ? `; ${compras}` : ''}`;
}

const formatoCantidad = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Meta rechaza parámetros con saltos de línea, tabulaciones o más de cuatro
 * espacios seguidos, y los muy largos. Se limpian antes de mandar.
 */
export function paraParametro(v: string): string {
  const limpio = String(v ?? '')
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return (limpio || '—').slice(0, 900);
}
