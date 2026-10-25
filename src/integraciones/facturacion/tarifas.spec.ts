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
  esCobrable,
  cargoDelEmisor,
  liquidar,
  periodoAnterior,
  periodoDe,
  rangoDelPeriodo,
} from './tarifas';

describe('tarifa por empresa, como apisunat (24-10)', () => {
  it('hasta 20 comprobantes: S/ 0.05 cada uno', () => {
    expect(cargoDelEmisor(0)).toBe(0);
    expect(cargoDelEmisor(18)).toBe(0.9); // Ferretería Ortega, mayo 2025: S/ 1.06 con IGV
    expect(cargoDelEmisor(20)).toBe(1);
  });
  it('de 21 a 100: S/ 5.00 fijo', () => {
    expect(cargoDelEmisor(21)).toBe(5);
    expect(cargoDelEmisor(57)).toBe(5);
    expect(cargoDelEmisor(98)).toBe(5); // marzo 2026: S/ 5.90 con IGV
    expect(cargoDelEmisor(100)).toBe(5);
  });
  it('más de 100: S/ 5.00 + S/ 0.05 por cada uno extra', () => {
    expect(cargoDelEmisor(101)).toBe(5.05);
    expect(cargoDelEmisor(1000)).toBe(50);
  });
  it('entradas raras: negativo es cero, decimales se truncan', () => {
    expect(cargoDelEmisor(-5)).toBe(0);
    expect(cargoDelEmisor(20.9)).toBe(1);
  });
});

describe('el integrador paga la suma de sus empresas, más IGV', () => {
  it('tres empresas', () => {
    const l = liquidar([18, 98, 150]);
    expect(l.porEmisor).toEqual([0.9, 5, 7.5]);
    expect(l).toMatchObject({ cantidad: 266, subtotal: 13.4, igv: 2.41, total: 15.81, aplicoMinimo: false, ajusteMinimo: 0 });
  });
  it('una empresa de 98: S/ 5.90 con IGV, igual que apisunat', () => {
    expect(liquidar([98]).total).toBe(5.9);
  });
  it('sin comprobantes no se cobra nada (ya no hay mínimo)', () => {
    expect(liquidar([])).toMatchObject({ cantidad: 0, subtotal: 0, total: 0, precioUnitario: 0 });
  });
  it('acepta un número suelto como una sola empresa', () => {
    expect(liquidar(30).subtotal).toBe(5);
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
