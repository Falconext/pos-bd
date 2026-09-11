import * as XLSX from 'xlsx';

// archiver@8 es ESM puro y jest no lo transforma; este spec no genera ZIPs.
jest.mock('archiver', () => jest.fn());

import { ComprobanteService } from './comprobante.service';

/**
 * Export resumen de ventas a Excel: una fila por producto (pedido del cliente).
 * Se instancia el servicio sin DI porque exportarResumenComprobantes solo usa
 * prisma y construirWhereComprobantesMasivo.
 */
describe('ComprobanteService.exportarResumenComprobantes (excel)', () => {
  const comprobantes = [
    {
      fechaEmision: new Date('2026-09-08T15:17:00Z'),
      tipoDoc: 'TICKET',
      serie: 'T001',
      correlativo: 4,
      medioPago: 'EFECTIVO',
      estadoPago: 'COMPLETADO',
      estadoEnvioSunat: 'PENDIENTE',
      mtoImpVenta: 230,
      saldo: 0,
      vendedorCampoNombre: null,
      cliente: { nombre: 'CLIENTES VARIOS', nroDoc: '10000000' },
      usuario: { nombre: 'Nicoly' },
      pagos: [],
      envioDespacho: null,
      detalles: [{ descripcion: 'atornillador total 20v', cantidad: 1 }],
    },
    {
      fechaEmision: new Date('2026-09-08T18:58:00Z'),
      tipoDoc: '01',
      serie: 'F0A1',
      correlativo: 8,
      medioPago: 'Transferencia',
      estadoPago: 'COMPLETADO',
      estadoEnvioSunat: 'EMITIDO',
      mtoImpVenta: 2640,
      saldo: 0,
      vendedorCampoNombre: null,
      cliente: { nombre: 'GRUPO MAEDSA S.A.C.', nroDoc: '20601473209' },
      usuario: { nombre: 'Nicoly' },
      pagos: [],
      envioDespacho: null,
      detalles: [
        { descripcion: 'manga azul 2', cantidad: 2 },
        { descripcion: 'manguera succion 3', cantidad: 1 },
        { descripcion: 'motobomba 3x3 gp200', cantidad: 3 },
      ],
    },
    {
      // Anulado: no suma al total general
      fechaEmision: new Date('2026-09-08T20:00:00Z'),
      tipoDoc: '03',
      serie: 'B0A1',
      correlativo: 1,
      medioPago: 'YAPE',
      estadoPago: 'ANULADO',
      estadoEnvioSunat: 'ANULADO',
      mtoImpVenta: 100,
      saldo: 0,
      vendedorCampoNombre: null,
      cliente: { nombre: 'JUAN', nroDoc: '12345678' },
      usuario: { nombre: 'Nicoly' },
      pagos: [],
      envioDespacho: null,
      detalles: [{ descripcion: 'x', cantidad: 5 }],
    },
  ];

  const crearServicio = () => {
    const service = Object.create(ComprobanteService.prototype) as any;
    service.prisma = {
      comprobante: { findMany: jest.fn().mockResolvedValue(comprobantes) },
      empresa: {
        findUnique: jest.fn().mockResolvedValue({
          razonSocial: 'EMPRESA SA',
          nombreComercial: null,
          ruc: '20123456789',
        }),
      },
    };
    service.construirWhereComprobantesMasivo = jest.fn().mockResolvedValue({});
    return service;
  };

  const leerHoja = (buffer: Buffer): any[][] => {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  };

  it('genera una fila por producto, repitiendo datos y totales de la venta', async () => {
    const service = crearServicio();
    const res = await service.exportarResumenComprobantes({
      empresaId: 1,
      tipoComprobante: 'TODOS',
      fechaInicio: '2026-09-08',
      fechaFin: '2026-09-08',
      formato: 'excel',
    });
    expect(res.filename).toBe('ventas_2026-09-08_a_2026-09-08.xlsx');

    const aoa = leerHoja(res.buffer);
    const headers = aoa[2];
    expect(headers.slice(-3)).toEqual(['Productos', 'Total Unid.', 'Total S/']);
    const iDoc = headers.indexOf('Documento');
    const iProd = headers.indexOf('Productos');
    const iUnid = headers.indexOf('Total Unid.');
    const iTotal = headers.indexOf('Total S/');

    // 1 + 3 + 1 = 5 filas de datos (una por producto)
    const datos = aoa.slice(3, 8);
    expect(datos.map((r) => r[iDoc])).toEqual([
      'T001-00000004',
      'F0A1-00000008',
      'F0A1-00000008',
      'F0A1-00000008',
      'B0A1-00000001',
    ]);
    expect(datos.map((r) => r[iProd])).toEqual([
      '1x atornillador total 20v',
      '2x manga azul 2',
      '1x manguera succion 3',
      '3x motobomba 3x3 gp200',
      '5x x',
    ]);
    // Total de unidades y Total S/ de la venta completa, repetidos por fila
    expect(datos.map((r) => r[iUnid])).toEqual([1, 6, 6, 6, 5]);
    expect(datos.map((r) => r[iTotal])).toEqual([230, 2640, 2640, 2640, 100]);
    // Ningún producto queda apilado en una sola celda
    expect(datos.some((r) => String(r[iProd]).includes('\n'))).toBe(false);

    // Fila vacía y luego TOTAL: suma una vez por venta (sin anulados)
    expect(aoa[8].every((v) => v === '')).toBe(true);
    const totalRow = aoa[9];
    expect(totalRow[iTotal]).toBe(2870);
    expect(totalRow[iUnid]).toBe('');
    expect(totalRow[iProd]).toBe('TOTAL (sin anulados)');
  });

  it('si la columna Productos está oculta, mantiene una fila por venta', async () => {
    const service = crearServicio();
    const res = await service.exportarResumenComprobantes({
      empresaId: 1,
      tipoComprobante: 'TODOS',
      columnas: 'mpago,sunat',
      formato: 'excel',
    });
    const aoa = leerHoja(res.buffer);
    const headers = aoa[2];
    expect(headers).not.toContain('Productos');
    expect(headers.slice(-2)).toEqual(['Total Unid.', 'Total S/']);
    const iDoc = headers.indexOf('Documento');
    expect(aoa.slice(3, 6).map((r) => r[iDoc])).toEqual([
      'T001-00000004',
      'F0A1-00000008',
      'B0A1-00000001',
    ]);
    expect(aoa[6].every((v) => v === '')).toBe(true);
    expect(aoa[7][headers.indexOf('Total S/')]).toBe(2870);
  });

  it('el PDF no cambia: una fila por venta con productos apilados', async () => {
    const service = crearServicio();
    service.pdfGenerator = {
      generarPdfDesdeHtml: jest.fn(async (html: string) => Buffer.from(html)),
    };
    const res = await service.exportarResumenComprobantes({
      empresaId: 1,
      tipoComprobante: 'TODOS',
      formato: 'pdf',
    });
    expect(res.contentType).toContain('pdf');
    const html = res.buffer.toString();
    // 3 ventas => 3 filas en el cuerpo; productos apilados con <br>
    expect(html.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr/g)!.length).toBe(3);
    expect(html).toContain('2x manga azul 2<br>1x manguera succion 3<br>3x motobomba 3x3 gp200');
    expect(html).not.toContain('Total Unid.');
  });
});
