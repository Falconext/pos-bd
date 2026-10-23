/**
 * Recordatorio diario de recojo en agencia (Shalom/Olva).
 *
 * Hierba Sana, 23-10: el paquete llega a la agencia, se le avisa al cliente
 * una vez y después nadie sabe qué día irá a recogerlo ni si va a pagar el
 * saldo. El empresario lo seguía a mano todos los días. Esto lo hace solo:
 * un recordatorio por día, con tope, que se corta en cuanto el cliente
 * responde o el paquete se entrega.
 *
 * Todo lo que decide va acá, puro, para probarlo sin base ni WhatsApp.
 */

/** Fecha (yyyy-mm-dd) en Lima: "ya se le recordó hoy" se cuenta por día de Lima. */
export const diaLima = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(d);

/** Los 9 dígitos del celular peruano, venga como venga escrito. */
export function ultimos9(telefono: string | null | undefined): string | null {
  const d = String(telefono ?? '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
}

/** Cuándo llegó a la agencia: la última vez que el historial pasó a EN_AGENCIA. */
export function llegadaAAgencia(historial: unknown, respaldo: Date): Date {
  const filas = Array.isArray(historial) ? (historial as { estado?: string; fecha?: string }[]) : [];
  for (let i = filas.length - 1; i >= 0; i--) {
    if (filas[i]?.estado === 'EN_AGENCIA' && filas[i]?.fecha) {
      const f = new Date(filas[i].fecha!);
      if (!Number.isNaN(f.getTime())) return f;
    }
  }
  return respaldo;
}

export interface CasoRecojo {
  llegadaEn: Date;
  enviados: number;
  ultimoEn: Date | null;
  maxDias: number;
  /** Último mensaje que escribió el cliente al número del negocio, si hay chat. */
  ultimoMensajeClienteEn: Date | null;
  ahora: Date;
}

/** Por qué sí o por qué no: el motivo queda en el log para poder explicarlo. */
export function tocaRecordatorioRecojo(c: CasoRecojo): { toca: boolean; motivo: string } {
  if (c.maxDias <= 0) return { toca: false, motivo: 'apagado' };
  if (c.enviados >= c.maxDias) return { toca: false, motivo: 'tope' };
  // El día que llegó ya recibió el aviso de llegada: el recordatorio empieza
  // al día siguiente (de calendario: si llegó a las 6 p. m., al otro día a
  // media mañana ya toca; contar 24 h lo empujaba un día más).
  if (diaLima(c.ahora) <= diaLima(c.llegadaEn)) return { toca: false, motivo: 'recien-llego' };
  if (c.ultimoEn && diaLima(c.ultimoEn) === diaLima(c.ahora)) return { toca: false, motivo: 'ya-hoy' };
  // Si el cliente escribió después del último aviso, ya hay conversación: la
  // lleva el bot o el vendedor, y un recordatorio automático encima molesta.
  const ultimoAviso = c.ultimoEn ?? c.llegadaEn;
  if (c.ultimoMensajeClienteEn && c.ultimoMensajeClienteEn > ultimoAviso) {
    return { toca: false, motivo: 'cliente-respondio' };
  }
  return { toca: true, motivo: 'ok' };
}

/**
 * Lo que falta pagar para retirarlo. El saldo del comprobante manda; si no
 * hay, el monto contra entrega del despacho.
 */
export function saldoParaRetirar(saldo: unknown, montoCOD: unknown): number {
  const s = Number(saldo ?? 0);
  if (Number.isFinite(s) && s > 0.009) return Math.round(s * 100) / 100;
  const m = Number(montoCOD ?? 0);
  return Number.isFinite(m) && m > 0.009 ? Math.round(m * 100) / 100 : 0;
}

/** El texto de una plantilla con sus valores, para dejarlo en el chat del bot. */
export function textoDePlantilla(cuerpo: string, valores: string[]): string {
  return cuerpo.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => valores[Number(n) - 1] ?? '');
}
