/**
 * QA de impresión de la retención: plantillas reales, helpers reales.
 *
 * El defecto que motiva esto: el PDF decidía si imprimir la retención buscando
 * las palabras "RETENCIÓN" y "3%" dentro de las OBSERVACIONES. La única factura
 * real con retención —MODA & LINEA F0A1-41, S/1,180 con S/35.40 retenidos— fue
 * a SUNAT con su retención y salió impresa sin una sola línea, porque las
 * observaciones estaban vacías. El cliente recibió un papel que decía S/1,180
 * cuando iba a depositar S/1,144.60.
 *
 * Se renderizan las .hbs de verdad para que esto falle si alguien mueve el
 * bloque de sitio o le cambia las etiquetas.
 */
import * as fs from 'fs';
import * as Handlebars from 'handlebars';
import * as path from 'path';
import {
  baseRetencion,
  esRetencion,
  importeNetoACobrar,
  montoRetenido,
  porcentajeRetenido,
} from './retencion';

/** Los mismos helpers que registra PdfGeneratorService. */
const registrarHelpers = () => {
  Handlebars.registerHelper('includes', (s: string, sub: string) =>
    s && sub ? s.toUpperCase().includes(sub.toUpperCase()) : false);
  Handlebars.registerHelper('inc', (v: number) => v + 1);
  Handlebars.registerHelper('eq', (a: any, b: any) =>
    (a ?? '').toString().trim().toUpperCase() === (b ?? '').toString().trim().toUpperCase());
  Handlebars.registerHelper('or', (...args: any[]) => args.slice(0, -1).some((v) => !!v));
  Handlebars.registerHelper('vis', (fc: any, key: string) =>
    !fc || !fc[key] || fc[key].visible !== false);
  Handlebars.registerHelper('pos', (v: any) => Number(v) > 0);
  Handlebars.registerHelper('fsz', (fc: any, key: string, def: any) => {
    const n = Number(fc?.[key]?.size);
    return n > 0 ? n : Number(def) || 12;
  });
  Handlebars.registerHelper('tpx', (m: any, key: string, base?: any) => {
    const e = m?.[key];
    const b = Number(base);
    if (!e) return b > 0 ? b : 16;
    return b > 0 ? Math.max(8, Math.round(b * e.factor)) : e.px;
  });
};

const plantilla = (nombre: string) =>
  Handlebars.compile(
    fs.readFileSync(path.join(__dirname, 'templates', nombre), 'utf-8'),
  );

/**
 * Los mismos campos que arma `comprobante.service.ts` para la plantilla.
 * Si esto se desincroniza del service, el QA deja de valer: por eso usa las
 * funciones de `retencion.ts` y no números escritos a mano.
 */
const datosDePlantilla = (comp: any) => ({
  ...comp,
  simboloMoneda: 'S/',
  isDocumentoFiscal: true,
  mtoImpVenta: Number(comp.mtoImpVenta).toFixed(2),
  mtoOperGravadas: Number(comp.mtoOperGravadas ?? 0).toFixed(2),
  mtoIGV: Number(comp.mtoIGV ?? 0).toFixed(2),
  subTotal: Number(comp.mtoOperGravadas ?? 0).toFixed(2),
  shouldShowRetention: esRetencion(comp),
  retencionMonto: montoRetenido(comp).toFixed(2),
  retencionBase: baseRetencion(comp).toFixed(2),
  retencionPorcentaje: porcentajeRetenido(comp).toFixed(2),
  importeNeto: importeNetoACobrar(comp).toFixed(2),
  tipoDetraccion: comp.tipoDetraccionId ? '027 - Servicio de transporte (12%)' : undefined,
  montoDetraccion: comp.montoDetraccion
    ? Number(comp.montoDetraccion).toFixed(2) : undefined,
  items: [],
  detalles: [],
});

/** La factura de referencia: S/3,100 con S/93 retenidos. */
const CON_RETENCION = {
  mtoImpVenta: 3100, mtoOperGravadas: 2627.12, mtoIGV: 472.88,
  montoDetraccion: 93, porcentajeDetraccion: 3, tipoDetraccionId: null,
  observaciones: null,
};

const SIN_NADA = {
  mtoImpVenta: 3100, mtoOperGravadas: 2627.12, mtoIGV: 472.88,
  montoDetraccion: null, porcentajeDetraccion: null, tipoDetraccionId: null,
  observaciones: null,
};

const CON_DETRACCION = {
  mtoImpVenta: 3100, mtoOperGravadas: 2627.12, mtoIGV: 472.88,
  montoDetraccion: 372, porcentajeDetraccion: 12, tipoDetraccionId: 27,
  observaciones: null,
};

let a4: HandlebarsTemplateDelegate;
let ticket: HandlebarsTemplateDelegate;

beforeAll(() => {
  registrarHelpers();
  a4 = plantilla('comprobante.hbs');
  ticket = plantilla('comprobante-ticket.hbs');
});

describe('Factura A4 con retención', () => {
  let html: string;
  beforeAll(() => { html = a4(datosDePlantilla(CON_RETENCION)); });

  it('imprime el bloque, con las observaciones VACÍAS', () => {
    // Este es exactamente el caso de MODA & LINEA que salía en blanco.
    expect(html).toContain('Información de la retención');
  });

  it('muestra base, porcentaje y monto como la factura de referencia', () => {
    expect(html).toContain('Base imponible de la retención');
    expect(html).toContain('S/ 3100.00');
    expect(html).toContain('3.00 %');
    expect(html).toContain('S/ 93.00');
  });

  it('el TOTAL de la factura NO se reduce por la retención', () => {
    // Si el total bajara a 3,007 el comprobante no cuadraría con el XML.
    expect(html).toMatch(/MONTO TOTAL:[\s\S]{0,80}3100\.00/);
    expect(html).not.toMatch(/MONTO TOTAL:[\s\S]{0,80}3007\.00/);
  });

  it('dice cuánto se va a cobrar de verdad', () => {
    expect(html).toContain('Importe neto a pagar');
    expect(html).toContain('3007.00');
  });
});

describe('Facturas que NO deben mostrar retención', () => {
  it('una factura común no imprime nada de retención', () => {
    const html = a4(datosDePlantilla(SIN_NADA));
    expect(html).not.toContain('Base imponible de la retención');
  });

  it('una con detracción imprime detracción y NO retención', () => {
    // Comparten columnas: si se confunden, la detracción saldría como retención.
    const html = a4(datosDePlantilla(CON_DETRACCION));
    expect(html).toContain('OPERACIÓN SUJETA A DETRACCIÓN');
    expect(html).not.toContain('Base imponible de la retención');
  });

  it('ya NO inventa una retención por lo que digan las observaciones', () => {
    // Antes, escribir "RETENCIÓN 3%" en observaciones hacía aparecer una línea
    // de retención que no existía en el XML.
    const html = a4(datosDePlantilla({
      ...SIN_NADA, observaciones: 'APLICA RETENCIÓN DEL 3% SEGÚN ACUERDO',
    }));
    expect(html).not.toContain('Base imponible de la retención');
  });
});

describe('Ticket con retención', () => {
  it('imprime base, porcentaje, monto y neto', () => {
    const html = ticket(datosDePlantilla(CON_RETENCION));
    expect(html).toContain('INFORMACION DE LA RETENCION');
    expect(html).toContain('3100.00');
    expect(html).toContain('3.00 %');
    expect(html).toContain('93.00');
    expect(html).toContain('IMPORTE NETO A PAGAR');
    expect(html).toContain('3007.00');
  });

  it('un ticket sin retención no lo menciona', () => {
    const html = ticket(datosDePlantilla(SIN_NADA));
    expect(html).not.toContain('INFORMACION DE LA RETENCION');
  });
});
