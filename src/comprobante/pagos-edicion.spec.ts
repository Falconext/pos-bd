import { fecharPagosEdicion } from './pagos-edicion';

const ayer = new Date('2026-10-18T15:00:00Z');
const hoy = new Date('2026-10-19T15:00:00Z');

describe('fecharPagosEdicion — editar una nota ya cobrada', () => {
  it('DEMENVER: 20.80 de ayer se quedan ayer; solo 24.20 entra hoy', () => {
    const r = fecharPagosEdicion(
      [{ monto: 20.8, medioPago: 'EFECTIVO', fecha: ayer, usuarioId: 7 }],
      [{ method: 'EFECTIVO', amount: 45 }],
      hoy,
    );
    expect(r.map((x) => [x.amount, x.fecha.toISOString(), x.heredado, x.usuarioId])).toEqual([
      [20.8, ayer.toISOString(), true, 7],
      [24.2, hoy.toISOString(), false, null],
    ]);
  });

  it('cambio de medio: efectivo previo + diferencia por Yape', () => {
    const r = fecharPagosEdicion(
      [{ monto: 20.8, medioPago: 'EFECTIVO', fecha: ayer }],
      [{ method: 'EFECTIVO', amount: 20.8 }, { method: 'YAPE', amount: 24.2 }],
      hoy,
    );
    expect(r.map((x) => [x.method, x.amount, x.heredado])).toEqual([
      ['EFECTIVO', 20.8, true],
      ['YAPE', 24.2, false],
    ]);
  });

  it('nuevo total menor (devolución): queda solo lo que sigue cobrado, con su fecha', () => {
    const r = fecharPagosEdicion(
      [{ monto: 20.8, medioPago: 'EFECTIVO', fecha: ayer }],
      [{ method: 'EFECTIVO', amount: 15 }],
      hoy,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ amount: 15, heredado: true });
    expect(r[0].fecha.toISOString()).toBe(ayer.toISOString());
  });

  it('sin pagos previos todo es plata nueva (igual que antes)', () => {
    const r = fecharPagosEdicion([], [{ method: 'PLIN', amount: 10 }], hoy);
    expect(r).toEqual([expect.objectContaining({ method: 'PLIN', amount: 10, fecha: hoy, heredado: false })]);
  });

  it('varios abonos previos del mismo medio se consumen del más antiguo al más nuevo', () => {
    const anteayer = new Date('2026-10-17T15:00:00Z');
    const r = fecharPagosEdicion(
      [
        { monto: 5, medioPago: 'yape', fecha: ayer },
        { monto: 10, medioPago: 'YAPE', fecha: anteayer },
      ],
      [{ method: 'YAPE', amount: 12 }],
      hoy,
    );
    expect(r.map((x) => [x.amount, x.fecha.toISOString()])).toEqual([
      [10, anteayer.toISOString()],
      [2, ayer.toISOString()],
    ]);
  });
});

import { cobroDeEdicion } from './pagos-edicion';

describe('cobroDeEdicion — líneas del ticket del servidor', () => {
  it('nota editada con pago previo: PAGO ANTERIOR y RECIBIDO', () => {
    expect(cobroDeEdicion({ pagoAnterior: 20.8, recibido: 50, devolucion: 0 }, false)).toEqual({
      pagoAnterior: '20.80',
      recibido: '50.00',
    });
  });
  it('acepta el JSON como texto y muestra la devolución', () => {
    expect(cobroDeEdicion(JSON.stringify({ pagoAnterior: 20.8, devolucion: 7.3 }), false)).toEqual({
      pagoAnterior: '20.80',
      devolucion: '7.30',
    });
  });
  it('venta normal o a crédito: nada', () => {
    expect(cobroDeEdicion({ mode: 'SIMPLE', amount: 50 }, false)).toEqual({});
    expect(cobroDeEdicion({ pagoAnterior: 5 }, true)).toEqual({});
    expect(cobroDeEdicion(null, false)).toEqual({});
  });
});

import * as fs from 'fs';
import * as Handlebars from 'handlebars';
import * as path from 'path';

describe('plantillas del servidor (ticket y A4) — nota editada DEMENVER', () => {
  beforeAll(() => {
    Handlebars.registerHelper('includes', (s: string, sub: string) =>
      s && sub ? s.toUpperCase().includes(sub.toUpperCase()) : false);
    Handlebars.registerHelper('inc', (v: number) => v + 1);
    Handlebars.registerHelper('eq', (a: any, b: any) =>
      (a ?? '').toString().trim().toUpperCase() === (b ?? '').toString().trim().toUpperCase());
    Handlebars.registerHelper('or', (...args: any[]) => args.slice(0, -1).some((v) => !!v));
    Handlebars.registerHelper('vis', (fc: any, key: string) => !fc || !fc[key] || fc[key].visible !== false);
    Handlebars.registerHelper('pos', (v: any) => Number(v) > 0);
    Handlebars.registerHelper('fsz', (fc: any, key: string, def: any) => Number(fc?.[key]?.size) > 0 ? Number(fc[key].size) : Number(def) || 12);
    Handlebars.registerHelper('tpx', (m: any, key: string, base?: any) => (Number(base) > 0 ? Number(base) : 16));
  });
  const render = (nombre: string, extra: any) =>
    Handlebars.compile(fs.readFileSync(path.join(__dirname, 'templates', nombre), 'utf-8'))({
      simboloMoneda: 'S/', mtoImpVenta: '45.00', productos: [], items: [], detalles: [],
      formaPago: 'CONTADO', medioPago: 'EFECTIVO', vuelto: '25.80', pagado: '45.00', ...extra,
    }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  for (const nombre of ['comprobante-ticket.hbs', 'comprobante.hbs']) {
    it(`${nombre}: PAGO ANTERIOR 20.80, RECIBIDO 50.00, VUELTO 25.80, PAGADO 45.00`, () => {
      const t = render(nombre, cobroDeEdicion({ pagoAnterior: 20.8, recibido: 50 }, false));
      expect(t).toMatch(/PAGO ANTERIOR: S\/ 20\.80 .*RECIBIDO: S\/ 50\.00 .*VUELTO: S\/ 25\.80 .*PAGADO: S\/ 45\.00/);
    });
    it(`${nombre}: venta normal sin líneas nuevas`, () => {
      const t = render(nombre, cobroDeEdicion({ mode: 'SIMPLE', amount: 50 }, false));
      expect(t).not.toContain('PAGO ANTERIOR');
      expect(t).not.toContain('RECIBIDO');
      expect(t).toContain('VUELTO: S/ 25.80');
    });
  }
});
