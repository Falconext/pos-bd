/**
 * Los motivos de un ajuste manual de stock, en palabras.
 *
 * Espejo de `frontend/src/features/admin/kardex/products/motivoAjusteStock.ts`:
 * el POS elige el código, el backend lo convierte en la frase que queda
 * guardada en el kardex. Se traduce acá y no en la pantalla para que el
 * historial sea legible desde cualquier lado —un export, un reporte, la app
 * móvil— sin depender de que el cliente sepa descifrar "MERMA".
 */

const ETIQUETAS: Record<string, string> = {
  // Salidas
  MERMA: 'Merma (producto roto o dañado)',
  VENCIDO: 'Vencido o en mal estado',
  CONSUMO_INTERNO: 'Consumo interno del negocio',
  PERDIDA: 'Pérdida o robo',
  DEVOLUCION_PROVEEDOR: 'Devolución al proveedor',
  // Ingresos
  ENCONTRADO: 'Encontrado en inventario',
  DEVOLUCION_CLIENTE: 'Devolución de un cliente',
  CONTEO: 'Corrección por conteo físico',
  // Ambos
  ERROR_REGISTRO: 'Error de registro anterior',
  OTRO: 'Otro motivo',
};

/**
 * La frase del motivo, o vacío si no vino ninguno.
 *
 * Un código desconocido se devuelve tal cual en vez de descartarse: es
 * preferible un kardex que diga algo raro a uno que no diga nada, que es el
 * problema que esto vino a resolver.
 */
export const etiquetaDeMotivo = (codigo?: string | null): string => {
  const c = String(codigo ?? '').trim().toUpperCase();
  if (!c) return '';
  return ETIQUETAS[c] ?? c;
};

/** Separador entre el motivo y el resto del concepto del movimiento. */
export const SEPARADOR_CONCEPTO = ' · ';

/** Los motivos que representan PÉRDIDA de mercadería, no una corrección. */
export const MOTIVOS_DE_PERDIDA = ['MERMA', 'VENCIDO', 'PERDIDA'];

/**
 * El motivo que lleva un movimiento, leído de su concepto.
 *
 * El concepto se guarda como "Merma (producto roto o dañado) · Ajuste de
 * inventario (-9)". Se lee de ahí y no de una columna aparte porque así
 * funciona también para los movimientos ya registrados.
 *
 * Devuelve null para todo lo demás —ventas, compras, traslados, y los ajustes
 * viejos sin motivo—, que no son mermas y no deben contarse como tales.
 */
export const motivoDelConcepto = (
  concepto?: string | null,
): { codigo: string; etiqueta: string } | null => {
  const texto = String(concepto ?? '');
  const corte = texto.indexOf(SEPARADOR_CONCEPTO);
  if (corte < 0) return null;
  const etiqueta = texto.slice(0, corte).trim();
  if (!etiqueta) return null;
  const codigo = Object.keys(ETIQUETAS).find((k) => ETIQUETAS[k] === etiqueta);
  return codigo ? { codigo, etiqueta } : null;
};

/** ¿Este movimiento es una pérdida de mercadería? */
export const esPerdida = (concepto?: string | null): boolean => {
  const m = motivoDelConcepto(concepto);
  return !!m && MOTIVOS_DE_PERDIDA.includes(m.codigo);
};
