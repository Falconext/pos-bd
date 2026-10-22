import {
  TITULO_AVISO_RENOVACION,
  diasParaVencerLima,
  esAvisoObsoleto,
  inicioDelDiaLima,
  mensajeAvisoRenovacion,
} from './avisos-vencimiento';

const aviso = (creadoEn: string, titulo = TITULO_AVISO_RENOVACION) => ({ titulo, creadoEn: new Date(creadoEn) });

describe('avisos de vencimiento de la campana', () => {
  it('renovado: el "vence mañana" de antes ya no se muestra (SANTOS CORREA, 22-10)', () => {
    // Avisado el 20/10 que vencía el 21/10; hoy vence el 21/11.
    expect(esAvisoObsoleto(aviso('2026-10-20T14:00:00Z'), new Date('2026-11-21T00:00:00Z'))).toBe(true);
  });

  it('sin renovar, los avisos de esta semana siguen valiendo', () => {
    const vence = new Date('2026-10-25T00:00:00Z');
    expect(esAvisoObsoleto(aviso('2026-10-18T14:00:00Z'), vence)).toBe(false);
    expect(esAvisoObsoleto(aviso('2026-10-22T14:00:00Z'), vence)).toBe(false);
  });

  it('otras notificaciones no se tocan', () => {
    expect(esAvisoObsoleto(aviso('2026-01-01T00:00:00Z', 'Stock bajo'), new Date('2027-01-01T00:00:00Z'))).toBe(false);
    expect(esAvisoObsoleto(aviso('2026-10-20T14:00:00Z'), null)).toBe(false);
  });

  it('los días se cuentan en el calendario de Lima, también de noche', () => {
    const vence = new Date('2026-10-25T00:00:00Z'); // vence el 25
    expect(diasParaVencerLima(vence, new Date('2026-10-22T14:00:00Z'))).toBe(3); // 9 a. m. del 22
    expect(diasParaVencerLima(vence, new Date('2026-10-23T02:00:00Z'))).toBe(3); // 9 p. m. del 22
    expect(diasParaVencerLima(vence, new Date('2026-10-25T20:00:00Z'))).toBe(0);
  });

  it('el mensaje dice hoy, mañana o los días que faltan', () => {
    expect(mensajeAvisoRenovacion(0).mensaje).toContain('vence hoy');
    expect(mensajeAvisoRenovacion(1).mensaje).toContain('vence mañana');
    expect(mensajeAvisoRenovacion(3)).toEqual({ tipo: 'WARNING', mensaje: 'Tu suscripción vence en 3 días. Considera renovar pronto.' });
  });

  it('el inicio del día de Lima son las 5 a. m. UTC', () => {
    expect(inicioDelDiaLima(new Date('2026-10-23T02:00:00Z')).toISOString()).toBe('2026-10-22T05:00:00.000Z');
  });
});
