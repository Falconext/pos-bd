/**
 * Retención del 3% de IGV.
 *
 * El caso que la motiva: IMPORTACIONES KAWAMOTO le factura S/3,100 a un agente
 * de retención y este le retiene S/93. La factura de referencia dice:
 *
 *     Base imponible de la retención   S/ 3,100.00
 *     Porcentaje de la retención       3.00 %
 *     Monto de la retención            S/ 93.00
 *     TOTAL                            S/ 3,100.00
 *
 * Dos cosas que ahí se ven y son fáciles de equivocar: la base es el total CON
 * IGV (no el subtotal), y el total de la factura NO baja.
 */
import {
  CODIGO_CARGO_RETENCION,
  UMBRAL_RETENCION,
  allowanceChargeRetencion,
  aplicaRetencion,
  baseRetencion,
  calcularRetencion,
  esRetencion,
  importeNetoACobrar,
  leyendaRetencion,
  montoRetenido,
  porcentajeRetenido,
} from './retencion';

const agente = (extra: Record<string, unknown> = {}) => ({
  tipoDoc: '01',
  total: 3100,
  clienteEsAgenteRetencion: true,
  ...extra,
});

describe('La factura de KAWAMOTO, que es la referencia', () => {
  it('sobre S/3,100 retiene S/93', () => {
    expect(calcularRetencion(3100)).toBe(93);
  });

  it('la base es el total CON IGV, no el subtotal', () => {
    // Si alguien usara el gravado (2,627.12) saldrían S/78.81 y el agente
    // rechazaría la factura.
    const comp = { montoDetraccion: 93, mtoImpVenta: 3100, tipoDetraccionId: null };
    expect(baseRetencion(comp)).toBe(3100);
    expect(calcularRetencion(2627.12)).not.toBe(93);
  });

  it('el total de la factura no baja: lo que cambia es lo que se cobra', () => {
    const comp = { montoDetraccion: 93, mtoImpVenta: 3100, tipoDetraccionId: null };
    expect(baseRetencion(comp)).toBe(3100);
    expect(importeNetoACobrar(comp)).toBe(3007);
  });
});

describe('A quién se le retiene', () => {
  it('al cliente marcado como agente de retención', () => {
    expect(aplicaRetencion(agente())).toBe(true);
  });

  it('NO a un cliente común, aunque la factura sea grande', () => {
    // Es el motivo del cambio: antes el interruptor era por empresa y le
    // retenía a todo el mundo.
    expect(aplicaRetencion(agente({ clienteEsAgenteRetencion: false }))).toBe(false);
    expect(aplicaRetencion({ tipoDoc: '01', total: 50000 })).toBe(false);
  });

  it('el interruptor viejo por empresa sigue funcionando', () => {
    // Compatibilidad: si alguna empresa lo tuviera prendido, no cambia nada.
    expect(aplicaRetencion({
      tipoDoc: '01', total: 3100, empresaEsAgenteRetencion: true,
    })).toBe(true);
  });
});

describe('Cuándo NO corresponde retener', () => {
  it('en S/700 exactos no se retiene: la norma exonera "igual o menor"', () => {
    // El borde que estaba mal: antes retenía desde 700 inclusive.
    expect(aplicaRetencion(agente({ total: UMBRAL_RETENCION }))).toBe(false);
    expect(aplicaRetencion(agente({ total: 700.01 }))).toBe(true);
    expect(aplicaRetencion(agente({ total: 699.99 }))).toBe(false);
  });

  it('en una boleta no se retiene: no da crédito fiscal', () => {
    expect(aplicaRetencion(agente({ tipoDoc: '03' }))).toBe(false);
  });

  it('si la operación tiene detracción, no se retiene: se excluyen', () => {
    expect(aplicaRetencion(agente({ tieneDetraccion: true }))).toBe(false);
  });
});

describe('Reconocer una retención ya guardada', () => {
  const retencion = { montoDetraccion: 93, porcentajeDetraccion: 3, tipoDetraccionId: null, mtoImpVenta: 3100 };
  const detraccion = { montoDetraccion: 372, porcentajeDetraccion: 12, tipoDetraccionId: 27, mtoImpVenta: 3100 };

  it('una retención se distingue de una detracción por no tener tipo', () => {
    // De esto depende que el PDF y el export de contabilidad no las confundan.
    expect(esRetencion(retencion)).toBe(true);
    expect(esRetencion(detraccion)).toBe(false);
  });

  it('una detracción no reporta monto ni base de retención', () => {
    expect(montoRetenido(detraccion)).toBe(0);
    expect(baseRetencion(detraccion)).toBe(0);
    expect(porcentajeRetenido(detraccion)).toBe(0);
  });

  it('usa el monto GUARDADO, no lo recalcula', () => {
    // El PDF recalculaba total*0.03 por su cuenta; si el dato guardado difiere
    // (redondeo, porcentaje distinto), el papel y el XML dejaban de coincidir.
    const raro = { montoDetraccion: 92.5, porcentajeDetraccion: 3, tipoDetraccionId: null, mtoImpVenta: 3100 };
    expect(montoRetenido(raro)).toBe(92.5);
    expect(importeNetoACobrar(raro)).toBe(3007.5);
  });

  it('sin retención ni detracción, el neto es el total', () => {
    const simple = { mtoImpVenta: 1180, tipoDetraccionId: null };
    expect(esRetencion(simple)).toBe(false);
    expect(montoRetenido(simple)).toBe(0);
    expect(importeNetoACobrar(simple)).toBe(1180);
  });
});

describe('Redondeo a dos decimales', () => {
  it('no arrastra la basura del punto flotante', () => {
    expect(calcularRetencion(1180)).toBe(35.4);
    expect(calcularRetencion(1234.57)).toBe(37.04);
    expect(calcularRetencion(0)).toBe(0);
  });
});

describe('Lo que ve SUNAT: el XML', () => {
  const RETENIDA = {
    montoDetraccion: 93, porcentajeDetraccion: 3,
    tipoDetraccionId: null, mtoImpVenta: 3100,
  };

  it('la factura retenida lleva la leyenda 2006', () => {
    expect(leyendaRetencion(RETENIDA)).toEqual({
      _text: 'OPERACIÓN SUJETA A RETENCIÓN DEL 3%',
      _attributes: { languageLocaleID: '2006' },
    });
  });

  it('una factura común no lleva leyenda de retención', () => {
    expect(leyendaRetencion({ mtoImpVenta: 3100, tipoDetraccionId: null })).toBeNull();
  });

  it('el AllowanceCharge va como DESCUENTO con el código 62', () => {
    const cargo: any = allowanceChargeRetencion(RETENIDA, 'PEN');
    expect(cargo['cbc:ChargeIndicator']._text).toBe('false');
    expect(cargo['cbc:AllowanceChargeReasonCode']._text).toBe(CODIGO_CARGO_RETENCION);
  });

  it('manda base 3100, factor 0.03 y monto 93', () => {
    // Los tres números que SUNAT cruza. La base es el TOTAL con IGV: si se
    // mandara el gravado (2627.12) el comprobante saldría observado.
    const cargo: any = allowanceChargeRetencion(RETENIDA, 'PEN');
    expect(cargo['cbc:BaseAmount']._text).toBe(3100);
    expect(cargo['cbc:MultiplierFactorNumeric']._text).toBe(0.03);
    expect(cargo['cbc:Amount']._text).toBe(93);
    expect(cargo['cbc:Amount']._attributes.currencyID).toBe('PEN');
  });

  it('respeta la moneda del comprobante', () => {
    const cargo: any = allowanceChargeRetencion(RETENIDA, 'USD');
    expect(cargo['cbc:BaseAmount']._attributes.currencyID).toBe('USD');
  });

  it('una detracción NO genera AllowanceCharge de retención', () => {
    // Comparten columnas: si se confundieran, la detracción viajaría a SUNAT
    // como un descuento del comprobante.
    const detraccion = {
      montoDetraccion: 372, porcentajeDetraccion: 12,
      tipoDetraccionId: 27, mtoImpVenta: 3100,
    };
    expect(allowanceChargeRetencion(detraccion, 'PEN')).toBeNull();
    expect(leyendaRetencion(detraccion)).toBeNull();
  });

  it('sin porcentaje guardado asume 3%, no rompe el XML', () => {
    // Antes esta forma NO generaba AllowanceCharge (exigía porcentaje truthy).
    // No hay ninguna así en producción; queda fijado el comportamiento.
    const sinPct: any = allowanceChargeRetencion(
      { montoDetraccion: 93, porcentajeDetraccion: null, tipoDetraccionId: null, mtoImpVenta: 3100 },
      'PEN',
    );
    expect(sinPct['cbc:MultiplierFactorNumeric']._text).toBe(0.03);
    expect(sinPct['cbc:Amount']._text).toBe(93);
  });
});
