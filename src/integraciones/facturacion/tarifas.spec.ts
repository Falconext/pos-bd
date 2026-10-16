/**
 * El cálculo de lo que se le cobra a un integrador.
 *
 * Es el archivo donde un error se traduce directo en plata: cobrarle de más a
 * un cliente o regalarle margen a Krezka, y las dos cosas se descubren tarde,
 * cuando ya se emitió la factura. Por eso se prueba cada borde de tramo con
 * los números exactos del portal.
 */
import {
  ESTADOS_COBRABLES,
  MINIMO_MENSUAL,
  esCobrable,
  liquidar,
  periodoAnterior,
  periodoDe,
  precioPorComprobante,
  rangoDelPeriodo,
} from './tarifas';

describe('el precio según el volumen del mes', () => {
  it('hasta 20,000 cuesta S/0.05', () => {
    expect(precioPorComprobante(1)).toBe(0.05);
    expect(precioPorComprobante(19_999)).toBe(0.05);
    expect(precioPorComprobante(20_000)).toBe(0.05);
  });

  it('de 20,001 a 50,000 cuesta S/0.04', () => {
    expect(precioPorComprobante(20_001)).toBe(0.04);
    expect(precioPorComprobante(50_000)).toBe(0.04);
  });

  it('más de 50,000 cuesta S/0.03', () => {
    expect(precioPorComprobante(50_001)).toBe(0.03);
    expect(precioPorComprobante(1_000_000)).toBe(0.03);
  });

  it('cero comprobantes no rompe el cálculo', () => {
    expect(precioPorComprobante(0)).toBe(0.05);
  });
});

describe('el tramo se aplica al TOTAL del mes, no por escalones', () => {
  // Es la regla más fácil de implementar mal y la que está publicada. Por
  // escalones, 25,000 saldría 20,000×0.05 + 5,000×0.04 = S/1,200. Pero el
  // texto que el integrador leyó dice que el tramo se aplica al total:
  // 25,000 × 0.04 = S/1,000. Son S/200 de diferencia.
  it('25,000 comprobantes son 25,000 × 0.04', () => {
    const l = liquidar(25_000);
    expect(l.precioUnitario).toBe(0.04);
    expect(l.subtotal).toBe(1_000);
    expect(l.subtotal).not.toBe(1_200); // lo que daría por escalones
  });

  it('60,000 comprobantes son 60,000 × 0.03', () => {
    expect(liquidar(60_000).subtotal).toBe(1_800);
  });

  it('cruzar el tramo puede abaratar el total, y es a propósito', () => {
    // A 20,000 son S/1,000; a 20,001 son S/800.04. Está publicado así: el
    // precio baja al subir de tramo y se aplica a todo el volumen. No se
    // "arregla", porque arreglarlo seria cobrar algo distinto a lo prometido.
    expect(liquidar(20_000).subtotal).toBe(1_000);
    expect(liquidar(20_001).subtotal).toBeLessThan(1_000);
  });
});

describe('el mínimo mensual', () => {
  it('reemplaza al consumo cuando queda por debajo, no se le suma', () => {
    // Sumarlo cobraría S/30 extra a todos los meses, que no es lo que dice
    // "mínimo mensual de S/30".
    const l = liquidar(100); // 100 × 0.05 = S/5
    expect(l.subtotalConsumo).toBe(5);
    expect(l.subtotal).toBe(MINIMO_MENSUAL);
    expect(l.aplicoMinimo).toBe(true);
    expect(l.ajusteMinimo).toBe(25);
  });

  it('un mes sin emitir nada igual paga el mínimo', () => {
    const l = liquidar(0);
    expect(l.subtotal).toBe(30);
    expect(l.cantidad).toBe(0);
    expect(l.aplicoMinimo).toBe(true);
  });

  it('en cuanto el consumo lo supera, el mínimo desaparece', () => {
    // 600 × 0.05 = S/30 exactos: el borde.
    expect(liquidar(600).aplicoMinimo).toBe(false);
    expect(liquidar(600).subtotal).toBe(30);
    expect(liquidar(600).ajusteMinimo).toBe(0);
    expect(liquidar(601).aplicoMinimo).toBe(false);
    expect(liquidar(601).subtotal).toBeCloseTo(30.05, 2);
  });
});

describe('el IGV y el redondeo', () => {
  it('se calcula sobre el subtotal, al céntimo', () => {
    const l = liquidar(1_000); // S/50
    expect(l.subtotal).toBe(50);
    expect(l.igv).toBe(9);
    expect(l.total).toBe(59);
  });

  it('el mínimo también lleva IGV', () => {
    const l = liquidar(0);
    expect(l.igv).toBe(5.4);
    expect(l.total).toBe(35.4);
  });

  it('no arrastra el error de coma flotante', () => {
    // 7 × 0.05 da 0.35000000000000003 en coma flotante.
    for (const n of [7, 333, 1_234, 7_777, 19_999]) {
      const l = liquidar(n);
      expect(l.subtotal).toBe(Math.round(l.subtotal * 100) / 100);
      expect(l.total).toBe(Math.round(l.total * 100) / 100);
      expect(String(l.total)).not.toMatch(/\d\.\d{3,}/);
    }
  });

  it('el total es siempre subtotal más IGV', () => {
    for (const n of [0, 1, 599, 600, 20_000, 20_001, 50_001]) {
      const l = liquidar(n);
      expect(l.total).toBeCloseTo(l.subtotal + l.igv, 2);
    }
  });
});

describe('entradas que no deberían llegar pero llegan', () => {
  it('una cantidad negativa cuenta como cero', () => {
    expect(liquidar(-50).cantidad).toBe(0);
    expect(liquidar(-50).subtotal).toBe(30);
  });

  it('una cantidad con decimales se trunca', () => {
    expect(liquidar(10.9).cantidad).toBe(10);
  });

  it('NaN y undefined cuentan como cero en vez de propagar NaN', () => {
    // Un NaN acá terminaría en una factura con total NaN.
    expect(liquidar(NaN).total).toBe(35.4);
    expect(liquidar(undefined as any).total).toBe(35.4);
  });
});

describe('qué comprobantes se cobran', () => {
  it('solo los que SUNAT aceptó', () => {
    expect(esCobrable('accepted')).toBe(true);
    expect(esCobrable('observed')).toBe(true);
  });

  it('un rechazado NO se cobra, aunque haya gastado una firma', () => {
    // Ese costo lo absorbe Krezka. Cobrarlo haría que el integrador pague dos
    // veces por una sola venta: la que falló y la que emitió corregida.
    expect(esCobrable('rejected')).toBe(false);
  });

  it('un anulado SÍ se cobra: existió y la firma se gastó', () => {
    // Lo que no se cobra es la comunicación de baja, que no es un comprobante.
    expect(esCobrable('voided')).toBe(true);
  });

  it('lo que todavía no resolvió no se cobra', () => {
    // Cobrar un `reconciling` sería facturar algo cuyo resultado no se sabe.
    for (const e of ['pending', 'sent', 'reconciling', 'voiding', null]) {
      expect(esCobrable(e)).toBe(false);
    }
  });

  it('la lista de cobrables no crece sin que alguien lo note', () => {
    expect([...ESTADOS_COBRABLES].sort()).toEqual(['accepted', 'observed', 'voided']);
  });
});

describe('los períodos', () => {
  it('se arma como AAAA-MM', () => {
    expect(periodoDe(new Date(2026, 9, 16))).toBe('2026-10');
    expect(periodoDe(new Date(2026, 0, 1))).toBe('2026-01');
  });

  it('usa la hora de Lima y no UTC', () => {
    // El 31 de octubre a las 20:00 de Lima ya es noviembre en UTC. Con
    // toISOString() ese comprobante caería en el período siguiente y el
    // integrador lo vería en la factura equivocada.
    expect(periodoDe(new Date(2026, 9, 31, 20, 0, 0))).toBe('2026-10');
    expect(periodoDe(new Date(2026, 9, 31, 23, 59, 59))).toBe('2026-10');
  });

  it('el anterior cruza bien el año', () => {
    expect(periodoAnterior(new Date(2026, 0, 3))).toBe('2025-12');
    expect(periodoAnterior(new Date(2026, 9, 1))).toBe('2026-09');
  });

  it('el rango abarca el mes entero y no se pisa con el siguiente', () => {
    const { desde, hasta } = rangoDelPeriodo('2026-02');
    expect(periodoDe(desde)).toBe('2026-02');
    expect(desde.getDate()).toBe(1);
    // El 29 de febrero de 2028 (bisiesto) tiene que entrar en su mes.
    const bis = rangoDelPeriodo('2028-02');
    expect(new Date(2028, 1, 29) >= bis.desde && new Date(2028, 1, 29) < bis.hasta).toBe(true);
    expect(hasta.getTime()).toBe(new Date(2026, 2, 1).getTime());
  });

  it('un período mal escrito se rechaza en vez de dar un rango raro', () => {
    for (const p of ['2026-13', '2026-00', 'octubre', '', '2026']) {
      expect(() => rangoDelPeriodo(p)).toThrow();
    }
  });
});
