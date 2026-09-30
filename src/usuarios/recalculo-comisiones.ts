/**
 * Qué comisiones se reemplazan al recalcular las de un vendedor.
 *
 * Vive aparte para poder probarse: el recálculo está dentro de `update` del
 * servicio de usuarios, que depende de Prisma y de media docena de lecturas.
 */

/** Lo mínimo de una comisión recalculada para decidir el reemplazo. */
export interface ComisionNueva {
  comprobanteId: number;
}

/**
 * Los comprobantes cuya comisión pendiente se puede borrar.
 *
 * Solo aquellos para los que el recálculo produjo una comisión nueva. La
 * versión anterior borraba las pendientes de TODOS los comprobantes del
 * vendedor y creaba las que hubiera calculado: si no calculaba ninguna
 * —porque en ese momento ni el producto ni el vendedor tenían comisión— el
 * borrado ya había ocurrido y el histórico desaparecía sin aviso.
 *
 * Un clic en "guardar usuario" podía vaciar meses de comisiones, y como nada
 * de esto deja rastro, después no hay forma de saber qué pasó.
 *
 * Preferible una comisión desactualizada a ninguna: la desactualizada se ve y
 * se corrige; la borrada no deja rastro.
 */
export const comprobantesAReemplazar = (
  nuevas: ComisionNueva[],
): number[] => [...new Set((nuevas ?? []).map((n) => Number(n.comprobanteId)))];
