import { DashboardService } from './dashboard.service';

/**
 * "Ventas por Canal" del dashboard. Un comprobante MIXTO (pagado con más de un
 * medio, ej. parte efectivo + parte Yape) no tiene un solo medio de pago: la
 * mezcla real vive en las filas de `Pago`.
 *
 * Caso DEMENVER (sede ZAPALLAL): una nota de venta ya cobrada que se convierte
 * en boleta deja sus pagos en la nota — no se copian al formal a propósito,
 * para no contar la plata dos veces en caja. El formal queda sin pagos y la
 * venta entera caía en "Otros"; ahora se lee la mezcla del documento de origen.
 */
describe('DashboardService.ventasPorCanalPen', () => {
  const crear = (comprobantes: any[]) => {
    const s = Object.create(DashboardService.prototype) as any;
    s.prisma = {
      comprobante: { findMany: jest.fn().mockResolvedValue(comprobantes) },
    };
    return s;
  };

  const pen = (medioPago: string, mtoImpVenta: number, _sum = true) => ({
    medioPago,
    tipoMoneda: 'PEN',
    tipoCambio: 1,
    _sum: { mtoImpVenta },
  });

  const comp = (
    mtoImpVenta: number,
    pagos: any[],
    pagosOrigen: any[] | null = null,
  ) => ({
    mtoImpVenta,
    tipoMoneda: 'PEN',
    tipoCambio: 1,
    pagos,
    comprobanteOrigen: pagosOrigen ? { pagos: pagosOrigen } : null,
  });

  const redondear = (r: any) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, Number((v as number).toFixed(2))]),
    );

  it('reparte un MIXTO con sus propios pagos entre efectivo y yape', async () => {
    const s = crear([
      comp(12.9, [
        { monto: 3, medioPago: 'EFECTIVO' },
        { monto: 9.9, medioPago: 'YAPE' },
      ]),
    ]);
    const r = await s.ventasPorCanalPen(
      [pen('MIXTO', 12.9), pen('EFECTIVO', 100)],
      {},
    );
    expect(redondear(r)).toEqual({
      sumTarjeta: 0,
      sumTransferencia: 0,
      sumRedes: 9.9,
      sumEfectivo: 103,
      sumOtros: 0,
    });
  });

  it('boleta convertida sin pagos propios: usa los del origen y NO cae en Otros', async () => {
    // B0A1-732 de DEMENVER: viene de NV01-3693 (EFECTIVO 20 + YAPE 9.30).
    const s = crear([
      comp(29.3, [], [
        { monto: 20, medioPago: 'EFECTIVO' },
        { monto: 9.3, medioPago: 'YAPE' },
      ]),
    ]);
    const r = await s.ventasPorCanalPen([pen('MIXTO', 29.3)], {});
    expect(redondear(r)).toEqual({
      sumTarjeta: 0,
      sumTransferencia: 0,
      sumRedes: 9.3,
      sumEfectivo: 20,
      sumOtros: 0,
    });
  });

  it('adelanto en la nota + saldo al emitir: suma los pagos del formal y los del origen', async () => {
    const s = crear([
      comp(100, [{ monto: 80, medioPago: 'TARJETA' }], [
        { monto: 20, medioPago: 'EFECTIVO' },
      ]),
    ]);
    const r = await s.ventasPorCanalPen([pen('MIXTO', 100)], {});
    expect(redondear(r)).toEqual({
      sumTarjeta: 80,
      sumTransferencia: 0,
      sumRedes: 0,
      sumEfectivo: 20,
      sumOtros: 0,
    });
  });

  it('ni el formal ni el origen tienen pagos: el monto no desaparece, va a Otros', async () => {
    const s = crear([comp(20, [], null)]);
    const r = await s.ventasPorCanalPen([pen('MIXTO', 20)], {});
    expect(r.sumOtros).toBe(20);
  });

  it('venta a crédito cobrada a medias: lo cobrado va a su canal, el saldo a Otros', async () => {
    const s = crear([comp(100, [{ monto: 60, medioPago: 'YAPE' }])]);
    const r = await s.ventasPorCanalPen([pen('MIXTO', 100)], {});
    expect(redondear(r)).toEqual({
      sumTarjeta: 0,
      sumTransferencia: 0,
      sumRedes: 60,
      sumEfectivo: 0,
      sumOtros: 40,
    });
  });

  it('pagos duplicados entre formal y origen: se prorratean, nunca supera la venta', async () => {
    // El mismo cobro quedó en los dos documentos: 100 de venta, 200 en pagos.
    const s = crear([
      comp(100, [{ monto: 100, medioPago: 'EFECTIVO' }], [
        { monto: 100, medioPago: 'YAPE' },
      ]),
    ]);
    const r = await s.ventasPorCanalPen([pen('MIXTO', 100)], {});
    expect(redondear(r)).toEqual({
      sumTarjeta: 0,
      sumTransferencia: 0,
      sumRedes: 50,
      sumEfectivo: 50,
      sumOtros: 0,
    });
  });

  it('los canales siempre suman el total de ventas de la cabecera', async () => {
    const s = crear([
      comp(29.3, [], [
        { monto: 20, medioPago: 'EFECTIVO' },
        { monto: 9.3, medioPago: 'YAPE' },
      ]),
      comp(130, [], [
        { monto: 20, medioPago: 'EFECTIVO' },
        { monto: 110, medioPago: 'PLIN' },
      ]),
    ]);
    const filas = [pen('MIXTO', 159.3), pen('EFECTIVO', 2831.4), pen('YAPE', 2536.8)];
    const r = await s.ventasPorCanalPen(filas, {});
    const total =
      r.sumTarjeta + r.sumTransferencia + r.sumRedes + r.sumEfectivo + r.sumOtros;
    expect(Number(total.toFixed(2))).toBe(159.3 + 2831.4 + 2536.8);
    expect(Number(r.sumOtros.toFixed(2))).toBe(0);
  });

  it('un medio desconocido sí es "Otros" de verdad', async () => {
    const s = crear([]);
    const r = await s.ventasPorCanalPen([pen('CANJE', 15)], {});
    expect(r.sumOtros).toBe(15);
  });

  it('sin comprobantes MIXTO no consulta la tabla', async () => {
    const s = crear([]);
    const r = await s.ventasPorCanalPen([pen('TARJETA', 50)], {});
    expect(r.sumTarjeta).toBe(50);
    expect(s.prisma.comprobante.findMany).not.toHaveBeenCalled();
  });

  it('red de seguridad: si la consulta por comprobante trae de menos, el resto se muestra', async () => {
    const s = crear([comp(40, [{ monto: 40, medioPago: 'EFECTIVO' }])]);
    // El groupBy dice 100 de MIXTO pero solo vino un comprobante de 40.
    const r = await s.ventasPorCanalPen([pen('MIXTO', 100)], {});
    expect(redondear(r)).toEqual({
      sumTarjeta: 0,
      sumTransferencia: 0,
      sumRedes: 0,
      sumEfectivo: 40,
      sumOtros: 60,
    });
  });

  it('MIXTO en dólares: convierte a soles con el tipo de cambio del comprobante', async () => {
    const s = crear([
      {
        mtoImpVenta: 100,
        tipoMoneda: 'USD',
        tipoCambio: 3.8,
        pagos: [
          { monto: 60, medioPago: 'EFECTIVO' },
          { monto: 40, medioPago: 'TRANSFERENCIA' },
        ],
        comprobanteOrigen: null,
      },
    ]);
    const r = await s.ventasPorCanalPen(
      [{ medioPago: 'MIXTO', tipoMoneda: 'USD', tipoCambio: 3.8, _sum: { mtoImpVenta: 100 } }],
      {},
    );
    expect(redondear(r)).toEqual({
      sumTarjeta: 0,
      sumTransferencia: 152,
      sumRedes: 0,
      sumEfectivo: 228,
      sumOtros: 0,
    });
  });
});
