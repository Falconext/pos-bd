/**
 * Reporte contable "Comprobantes SUNAT" e "Internos": qué suma y qué no.
 *
 * Criterio (decidido 2026-10-18, el mismo que SIRE verificó contra la
 * propuesta RVIE de SUNAT):
 *  - un comprobante suma en su mes de emisión a valor completo, AUNQUE esté
 *    ANULADO; lo resta su nota de crédito, en negativo, en el mes en que ELLA
 *    se emitió;
 *  - RECHAZADO y FALLIDO_ENVIO no suman (SUNAT nunca los aceptó) y se devuelven
 *    aparte con el motivo;
 *  - PENDIENTE sí suma;
 *  - todo se convierte a soles, conservando el total en moneda del documento;
 *  - exoneradas y exportación entran al resumen;
 *  - un informal ya convertido a boleta/factura (o una OT ya convertida a NV)
 *    no suma en "Internos": la venta vive en el documento que salió de él.
 */
import { ContabilidadService } from './contabilidad.service';
import { parseFechaEmision } from '../common/utils/fecha';

const fecha = new Date('2026-09-10T15:00:00.000Z');

const formal = (over: Record<string, any>) => ({
  id: 0,
  tipoDoc: '03',
  serie: 'B001',
  correlativo: 1,
  fechaEmision: fecha,
  tipoMoneda: 'PEN',
  tipoCambio: null,
  estadoEnvioSunat: 'EMITIDO',
  mtoOperGravadas: 0,
  mtoOperInafectas: 0,
  mtoOperExoneradas: 0,
  mtoOperExportacion: 0,
  mtoIGV: 0,
  mtoDescuentoGlobal: 0,
  mtoImpVenta: 0,
  motivo: null,
  numDocAfectado: null,
  cliente: { nombre: 'X', nroDoc: '1' },
  sede: { nombre: 'Principal' },
  ...over,
});

describe('ContabilidadService.obtenerReporte (Comprobantes SUNAT)', () => {
  const rows = [
    // B001-1: boleta normal
    formal({ id: 1, correlativo: 1, mtoOperGravadas: 100, mtoIGV: 18, mtoImpVenta: 118 }),
    // B001-2: boleta ANULADA por NC → sigue sumando en su mes
    formal({ id: 2, correlativo: 2, estadoEnvioSunat: 'ANULADO', mtoOperGravadas: 200, mtoIGV: 36, mtoImpVenta: 236 }),
    // NC de anulación de B001-2 → resta
    formal({ id: 3, tipoDoc: '07', serie: 'BC01', correlativo: 1, motivo: { codigo: '01', descripcion: 'Anulación', tipo: 'NC' }, numDocAfectado: 'B001-00000002', mtoOperGravadas: 200, mtoIGV: 36, mtoImpVenta: 236 }),
    // F001-1: RECHAZADA → fuera, con motivo
    formal({ id: 4, tipoDoc: '01', serie: 'F001', correlativo: 1, estadoEnvioSunat: 'RECHAZADO', mtoOperGravadas: 1000, mtoIGV: 180, mtoImpVenta: 1180 }),
    // F001-2: FALLIDO_ENVIO → fuera, con motivo
    formal({ id: 5, tipoDoc: '01', serie: 'F001', correlativo: 2, estadoEnvioSunat: 'FALLIDO_ENVIO', mtoOperGravadas: 500, mtoIGV: 90, mtoImpVenta: 590 }),
    // F001-3: PENDIENTE → suma
    formal({ id: 6, tipoDoc: '01', serie: 'F001', correlativo: 3, estadoEnvioSunat: 'PENDIENTE', mtoOperGravadas: 50, mtoIGV: 9, mtoImpVenta: 59 }),
    // F001-4: exportación en US$ 100 a TC 3.5 → S/ 350
    formal({ id: 7, tipoDoc: '01', serie: 'F001', correlativo: 4, tipoMoneda: 'USD', tipoCambio: 3.5, mtoOperExportacion: 100, mtoImpVenta: 100 }),
    // B001-3: exonerada (Ley de Amazonía)
    formal({ id: 8, correlativo: 3, mtoOperExoneradas: 80, mtoImpVenta: 80 }),
  ];

  let service: ContabilidadService;
  let findMany: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue(rows);
    service = new ContabilidadService({
      comprobante: { findMany },
    } as any);
  });

  it('solo saca a los no aceptados por SUNAT y los devuelve con motivo', async () => {
    const r = await service.obtenerReporte(1, '2026-09-01', '2026-09-30');

    expect(r.comprobantes.map((c) => c.id)).toEqual([1, 2, 3, 6, 7, 8]);
    expect(r.excluidos.map((c: any) => [c.id, c.motivoExclusion])).toEqual([
      [4, 'Rechazado por SUNAT'],
      [5, 'Falló el envío a SUNAT'],
    ]);
    // El where no filtra estado: todo lo emitido llega, y el filtro es en código
    expect(findMany.mock.calls[0][0].where.estadoEnvioSunat).toBeUndefined();
  });

  it('el anulado suma a valor completo y la NC resta; el neto cuadra', async () => {
    const { resumen } = await service.obtenerReporte(1, '2026-09-01', '2026-09-30');

    // 118 + 236 - 236 + 59 + 350 + 80
    expect(resumen.totalVenta).toBeCloseTo(607, 2);
    expect(resumen.totalBoletas).toBeCloseTo(118 + 236 + 80, 2);
    expect(resumen.totalFacturas).toBeCloseTo(59 + 350, 2);
    expect(resumen.totalNotasCredito).toBeCloseTo(236, 2);
    expect(resumen.totalIGV).toBeCloseTo(18 + 36 - 36 + 9, 2);
    expect(resumen.totalGravadas).toBeCloseTo(100 + 200 - 200 + 50, 2);
    expect(resumen.cantidadAnulados).toBe(1);
    expect(resumen.totalAnulados).toBeCloseTo(236, 2);
    // gravadas + inafectas + exoneradas + exportación + IGV = total
    expect(
      resumen.totalGravadas +
        resumen.totalInafectas +
        resumen.totalExoneradas +
        resumen.totalExportacion +
        resumen.totalIGV,
    ).toBeCloseTo(resumen.totalVenta, 2);
  });

  it('exoneradas y exportación entran al resumen', async () => {
    const { resumen } = await service.obtenerReporte(1, '2026-09-01', '2026-09-30');
    expect(resumen.totalExoneradas).toBeCloseTo(80, 2);
    expect(resumen.totalExportacion).toBeCloseTo(350, 2);
  });

  it('un documento en US$ se muestra en soles y conserva su total original', async () => {
    const r = await service.obtenerReporte(1, '2026-09-01', '2026-09-30');
    const usd = r.comprobantes.find((c) => c.id === 7)!;
    expect(usd.mtoImpVenta).toBeCloseTo(350, 2);
    expect(usd.mtoImpVentaDoc).toBeCloseTo(100, 2);
    expect(usd.mtoOperExportacion).toBeCloseTo(350, 2);
    expect(usd.tipoMoneda).toBe('USD');
  });

  it('el rango se interpreta en hora de Lima (-05:00)', async () => {
    await service.obtenerReporte(1, '2026-09-01', '2026-09-30');
    const { fechaEmision } = findMany.mock.calls[0][0].where;
    expect(fechaEmision.gte.toISOString()).toBe('2026-09-01T05:00:00.000Z');
    expect(fechaEmision.lte.toISOString()).toBe('2026-10-01T04:59:59.999Z');
  });
});

describe('ContabilidadService.obtenerReporteInformales (Internos)', () => {
  const informal = (over: Record<string, any>) => ({
    id: 0,
    tipoDoc: 'NV',
    serie: 'NV01',
    correlativo: 1,
    fechaEmision: fecha,
    mtoImpVenta: 0,
    tipoMoneda: 'PEN',
    tipoCambio: null,
    estadoPago: 'COMPLETADO',
    saldo: 0,
    medioPago: 'Efectivo',
    estadoOT: null,
    adelanto: null,
    cliente: { nombre: 'X', nroDoc: '1' },
    sede: { nombre: 'Principal' },
    comprobantesDerivados: [],
    ...over,
  });

  const rows = [
    informal({ id: 1, correlativo: 1, mtoImpVenta: 100 }),
    // NV ya convertida a boleta B001-5 → no suma acá
    informal({ id: 2, correlativo: 2, mtoImpVenta: 200, comprobantesDerivados: [{ tipoDoc: '03', serie: 'B001', correlativo: 5 }] }),
    // OT ya convertida a NV → tampoco
    informal({ id: 3, tipoDoc: 'OT', serie: 'OT01', correlativo: 1, mtoImpVenta: 300, comprobantesDerivados: [{ tipoDoc: 'NV', serie: 'NV01', correlativo: 9 }] }),
    // NV en US$ 10 a TC 3.5 → S/ 35
    informal({ id: 4, correlativo: 3, mtoImpVenta: 10, tipoMoneda: 'USD', tipoCambio: 3.5 }),
  ];

  it('excluye los ya convertidos, los informa aparte y convierte a soles', async () => {
    const service = new ContabilidadService({
      comprobante: { findMany: jest.fn().mockResolvedValue(rows) },
    } as any);
    const r = await service.obtenerReporteInformales(1, '2026-09-01', '2026-09-30');

    expect(r.comprobantes.map((c) => c.id)).toEqual([1, 4]);
    expect(r.resumen.totalVenta).toBeCloseTo(135, 2);
    expect(r.resumen.totalNotasVenta).toBeCloseTo(135, 2);
    expect(r.resumen.totalOrdenesTrabajo).toBe(0);
    expect(r.resumen.cantidadConvertidos).toBe(2);
    expect(r.resumen.totalConvertidos).toBeCloseTo(500, 2);
    expect(r.convertidos.map((c: any) => [c.id, c.convertidoA])).toEqual([
      [2, 'B001-00000005'],
      [3, 'NV01-00000009'],
    ]);
  });
});

describe('parseFechaEmision (importados un día antes)', () => {
  const enLima = (d: Date) =>
    d.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

  it('"YYYY-MM-DD" cae en ese mismo día en Lima, no en el anterior', () => {
    expect(enLima(parseFechaEmision('2026-07-01'))).toBe('2026-07-01');
    // lo que hacía antes el código:
    expect(enLima(new Date('2026-07-01'))).toBe('2026-06-30');
  });

  it('un ISO con hora (lo que manda el POS) se respeta tal cual', () => {
    const iso = '2026-09-10T15:23:45.000Z';
    expect(parseFechaEmision(iso).toISOString()).toBe(iso);
  });
});
