// Desglose de un pago MIXTO (p. ej. S/ 20 en efectivo + S/ 16 por Yape) para
// el PDF del servidor. Es el mismo criterio que frontend/src/utils/pagoMixto.ts:
// primero `paymentDetails.splitPayments` (lo que mandó el POS al emitir) y, en
// documentos viejos sin ese detalle, las filas de `Pago` agrupadas por medio.
// Antes el PDF (el que va por WhatsApp y "PDF servidor") decía solo "MIXTO".

export interface LineaPagoMixto {
  medio: string;
  monto: number;
}

const ETIQUETAS: Record<string, string> = {
  EFECTIVO: 'EFECTIVO',
  YAPE: 'YAPE',
  PLIN: 'PLIN',
  TRANSFERENCIA: 'TRANSFERENCIA',
  TARJETA: 'TARJETA',
};

const parsear = (pd: unknown): any => {
  if (typeof pd !== 'string') return pd;
  try {
    return JSON.parse(pd);
  } catch {
    return null;
  }
};

const agrupar = (filas: any[]): LineaPagoMixto[] => {
  const porMedio = new Map<string, number>();
  for (const f of filas) {
    const medio = String(f?.method ?? f?.medioPago ?? '').toUpperCase();
    const monto = Number(f?.amount ?? f?.monto ?? 0);
    if (!medio || !(monto > 0)) continue;
    porMedio.set(medio, (porMedio.get(medio) ?? 0) + monto);
  }
  return [...porMedio].map(([medio, monto]) => ({
    medio: ETIQUETAS[medio] ?? medio,
    monto: Math.round(monto * 100) / 100,
  }));
};

export function lineasPagoMixto(doc: {
  medioPago?: string | null;
  paymentDetails?: unknown;
  pagos?: { medioPago: string; monto: number }[];
}): LineaPagoMixto[] {
  if (String(doc?.medioPago || '').toUpperCase() !== 'MIXTO') return [];
  const pd = parsear(doc.paymentDetails);
  if (Array.isArray(pd?.splitPayments) && pd.splitPayments.length > 0) {
    return agrupar(pd.splitPayments);
  }
  return agrupar(doc.pagos ?? []);
}
