import { EstadoSunat, PrismaClient } from '@prisma/client';

/**
 * Notas de crédito "de anulación".
 *
 * Cuando una NC anula por completo a una boleta/factura (motivo 01 ó 06), el
 * comprobante afectado queda en estado ANULADO y deja de sumar en todos los
 * reportes. Restar además la NC descontaba la misma venta dos veces (caso
 * real: un día con 926 de ventas mostraba 788.50). Estos helpers identifican
 * esas NC para que los reportes las salten y solo resten las NC que corrigen
 * un documento vigente (devolución parcial, descuento posterior, etc.).
 */
export interface DocConAfectado {
  tipoDoc: string;
  numDocAfectado?: string | null;
}

type PrismaComprobante = Pick<PrismaClient, 'comprobante'>;

function parseClave(ref: string) {
  const idx = ref.lastIndexOf('-');
  if (idx <= 0) return null;
  const correlativo = Number(ref.slice(idx + 1));
  if (!Number.isFinite(correlativo)) return null;
  return { serie: ref.slice(0, idx), correlativo };
}

/** Claves `SERIE-CORRELATIVO` de los documentos afectados por NC que están ANULADOS. */
export async function clavesAfectadosAnulados(
  prisma: PrismaComprobante,
  empresaId: number,
  docs: DocConAfectado[],
): Promise<Set<string>> {
  const claves = new Map<string, { serie: string; correlativo: number }>();
  for (const d of docs) {
    if (d.tipoDoc !== '07') continue;
    const ref = (d.numDocAfectado || '').trim();
    const clave = parseClave(ref);
    if (clave) claves.set(ref, clave);
  }
  if (claves.size === 0) return new Set();

  const anulados = await prisma.comprobante.findMany({
    where: {
      empresaId,
      estadoEnvioSunat: EstadoSunat.ANULADO,
      OR: Array.from(claves.values()).map((k) => ({
        serie: k.serie,
        correlativo: k.correlativo,
      })),
    },
    select: { serie: true, correlativo: true },
  });
  return new Set(anulados.map((a) => `${a.serie}-${a.correlativo}`));
}

/** Devuelve la lista sin las NC cuyo documento afectado ya está ANULADO. */
export async function excluirNotasCreditoDeAnulacion<T extends DocConAfectado>(
  prisma: PrismaComprobante,
  empresaId: number,
  docs: T[],
): Promise<T[]> {
  const anulados = await clavesAfectadosAnulados(prisma, empresaId, docs);
  if (anulados.size === 0) return docs;
  return docs.filter(
    (d) =>
      d.tipoDoc !== '07' || !anulados.has((d.numDocAfectado || '').trim()),
  );
}
