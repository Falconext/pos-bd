/**
 * Cobrar varias notas de un cliente de una vez.
 *
 * El cliente paga su deuda acumulada (o parte): el monto se reparte de la nota
 * más antigua a la más nueva, que es como lo cuenta el empresario ("me pagó lo
 * de la semana pasada y algo de esta"). Sin Prisma, para poder probarlo entero.
 */

export interface NotaConSaldo {
    id: number;
    saldo: number;
    fechaEmision: Date | string;
}

const centimos = (n: number) => Math.round((Number(n) || 0) * 100);

/** Saldo total de las notas, en soles con 2 decimales. */
export const saldoTotal = (notas: NotaConSaldo[]): number =>
    notas.reduce((s, n) => s + Math.max(0, centimos(n.saldo)), 0) / 100;

/**
 * Cuánto se aplica a cada nota. Las que quedan sin monto no aparecen.
 * Lanza si el monto es 0 o supera el saldo total (no se cobra de más).
 */
export function repartirPago(notas: NotaConSaldo[], monto: number): { id: number; monto: number }[] {
    let resto = centimos(monto);
    if (resto <= 0) throw new Error('El monto debe ser mayor a 0');
    const total = centimos(saldoTotal(notas));
    if (resto > total) throw new Error(`El monto no puede exceder el saldo pendiente (${(total / 100).toFixed(2)})`);
    const ordenadas = [...notas]
        .filter((n) => centimos(n.saldo) > 0)
        .sort((a, b) => new Date(a.fechaEmision).getTime() - new Date(b.fechaEmision).getTime() || a.id - b.id);
    const reparto: { id: number; monto: number }[] = [];
    for (const n of ordenadas) {
        if (resto <= 0) break;
        const aplica = Math.min(resto, centimos(n.saldo));
        reparto.push({ id: n.id, monto: aplica / 100 });
        resto -= aplica;
    }
    return reparto;
}
