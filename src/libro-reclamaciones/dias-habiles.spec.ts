import {
  anioLima,
  calcularFechaLimite,
  diaDeFecha,
  diaLima,
  diasHabilesRestantes,
  domingoDePascua,
  esDiaHabil,
  esFeriadoPeru,
  sumarDiasHabiles,
  umbralPorVencer,
} from './dias-habiles';

/** Instante a partir de una hora de Lima (UTC-5). */
const lima = (iso: string) => new Date(`${iso}-05:00`);
/** Fin del día de Lima (23:59:59.999) expresado en UTC. */
const finDia = (yyyyMmDd: string) => lima(`${yyyyMmDd}T23:59:59.999`);

describe('Pascua y feriados del Perú', () => {
  it.each([
    [2019, 4, 21],
    [2024, 3, 31],
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
    [2038, 4, 25],
  ])('domingo de Pascua %i = %i/%i', (anio, mes, dia) => {
    expect(domingoDePascua(anio)).toEqual({ mes, dia });
  });

  it('Jueves y Viernes Santo 2026 (2 y 3 de abril) son feriados; el sábado no', () => {
    expect(esFeriadoPeru(diaDeFecha(2026, 4, 2))).toBe(true);
    expect(esFeriadoPeru(diaDeFecha(2026, 4, 3))).toBe(true);
    expect(esFeriadoPeru(diaDeFecha(2026, 4, 4))).toBe(false);
    expect(esFeriadoPeru(diaDeFecha(2026, 4, 1))).toBe(false);
  });

  it('Semana Santa se mueve con el año (2025: 17 y 18 de abril)', () => {
    expect(esFeriadoPeru(diaDeFecha(2025, 4, 17))).toBe(true);
    expect(esFeriadoPeru(diaDeFecha(2025, 4, 18))).toBe(true);
    expect(esFeriadoPeru(diaDeFecha(2025, 4, 2))).toBe(false);
  });

  it.each([
    '01-01',
    '05-01',
    '06-07',
    '06-29',
    '07-23',
    '07-28',
    '07-29',
    '08-06',
    '08-30',
    '10-08',
    '11-01',
    '12-08',
    '12-09',
    '12-25',
  ])('feriado fijo %s', (mmdd) => {
    const [m, d] = mmdd.split('-').map(Number);
    expect(esFeriadoPeru(diaDeFecha(2026, m, d))).toBe(true);
    expect(esDiaHabil(diaDeFecha(2026, m, d))).toBe(false);
  });

  it('sábado y domingo no son hábiles; un lunes común sí', () => {
    expect(esDiaHabil(diaDeFecha(2026, 10, 31))).toBe(false); // sábado
    expect(esDiaHabil(diaDeFecha(2026, 11, 1))).toBe(false); // domingo (y feriado)
    expect(esDiaHabil(diaDeFecha(2026, 11, 2))).toBe(true); // lunes
  });
});

describe('Plazo de 15 días hábiles', () => {
  it('cruza Jueves y Viernes Santo: registro lunes 30/03/2026 vence el 22/04/2026', () => {
    expect(calcularFechaLimite(lima('2026-03-30T10:00:00'))).toEqual(
      finDia('2026-04-22'),
    );
  });

  it('cruza 8 y 9 de diciembre y Navidad: viernes 04/12/2026 vence el 30/12/2026', () => {
    expect(calcularFechaLimite(lima('2026-12-04T15:00:00'))).toEqual(
      finDia('2026-12-30'),
    );
  });

  it('registro en fin de semana: sábado 31/10/2026 empieza a contar el lunes y vence el 20/11/2026', () => {
    expect(calcularFechaLimite(lima('2026-10-31T11:00:00'))).toEqual(
      finDia('2026-11-20'),
    );
  });

  it('cruce de año: 31/12/2026 a las 23:30 de Lima es 2026 y vence el 22/01/2027 (1 de enero no cuenta)', () => {
    const fecha = lima('2026-12-31T23:30:00');
    expect(fecha.toISOString()).toBe('2027-01-01T04:30:00.000Z');
    expect(anioLima(fecha)).toBe(2026);
    expect(calcularFechaLimite(fecha)).toEqual(finDia('2027-01-22'));
  });

  it('usa el día de Lima, no el de UTC: lunes 23:59 de Lima cuenta desde el martes', () => {
    const lunesNoche = lima('2026-03-02T23:59:00'); // 2026-03-03T04:59Z
    expect(diaLima(lunesNoche)).toBe(diaDeFecha(2026, 3, 2));
    expect(sumarDiasHabiles(lunesNoche, 1)).toEqual(finDia('2026-03-03'));
  });

  it('cruza 28 y 29 de julio (martes y miércoles en 2026)', () => {
    // Lun 27/07 → 30(1) 31(2) 3/8(3) 4(4) 5(5) 6 feriado, 7(6) 10(7) …
    expect(sumarDiasHabiles(lima('2026-07-27T09:00:00'), 7)).toEqual(
      finDia('2026-08-10'),
    );
  });

  it('rechaza n negativo o no entero', () => {
    expect(() => sumarDiasHabiles(new Date(), -1)).toThrow(RangeError);
    expect(() => sumarDiasHabiles(new Date(), 1.5)).toThrow(RangeError);
  });
});

describe('Días hábiles restantes', () => {
  const limite = finDia('2026-04-22'); // miércoles

  it('vence hoy → 0', () => {
    expect(diasHabilesRestantes(limite, lima('2026-04-22T10:00:00'))).toBe(0);
  });

  it('dos días antes → 2', () => {
    expect(diasHabilesRestantes(limite, lima('2026-04-20T08:00:00'))).toBe(2);
  });

  it('desde el registro quedan 15', () => {
    expect(diasHabilesRestantes(limite, lima('2026-03-30T10:00:00'))).toBe(15);
  });

  it('un día hábil después del vencimiento → -1', () => {
    expect(diasHabilesRestantes(limite, lima('2026-04-23T09:00:00'))).toBe(-1);
  });

  it('el sábado tras un viernes límite ya es vencido (-1, nunca 0)', () => {
    expect(
      diasHabilesRestantes(finDia('2026-04-24'), lima('2026-04-25T09:00:00')),
    ).toBe(-1);
  });

  it('umbral "por vencer" = fin del 3.er día hábil siguiente', () => {
    // Jueves 01/10/2026 → vie 2 (1), lun 5 (2), mar 6 (3)
    expect(umbralPorVencer(lima('2026-10-01T08:30:00'))).toEqual(
      finDia('2026-10-06'),
    );
  });

  it('umbral consistente con diasHabilesRestantes ≤ 3', () => {
    const ahora = lima('2026-10-01T08:30:00');
    const umbral = umbralPorVencer(ahora);
    expect(diasHabilesRestantes(umbral, ahora)).toBe(3);
    expect(diasHabilesRestantes(finDia('2026-10-07'), ahora)).toBe(4);
  });
});
