/**
 * C4 — cuándo la IA se calla y cuándo vuelve.
 *
 * El riesgo no es que se calle de más: es que se quede callada para siempre
 * (como pasaba antes) o que vuelva a meterse en medio de un reclamo que ya
 * está atendiendo una persona.
 */
import {
  PAUSA_INTERVENCION_MS,
  debeReactivarse,
  estaPausado,
  venceEn,
} from './pausa-bot';

const AHORA = new Date('2026-10-09T12:00:00Z');
const enMinutos = (m: number) => new Date(AHORA.getTime() + m * 60000);

describe('estaPausado', () => {
  it('con el bot activo nunca está pausado', () => {
    expect(estaPausado({ botActivo: true, pausadoHasta: null }, AHORA)).toBe(
      false,
    );
  });

  it('se calla mientras la pausa no vence', () => {
    expect(
      estaPausado({ botActivo: false, pausadoHasta: enMinutos(30) }, AHORA),
    ).toBe(true);
  });

  it('deja de estar pausado cuando la pausa vence', () => {
    expect(
      estaPausado({ botActivo: false, pausadoHasta: enMinutos(-1) }, AHORA),
    ).toBe(false);
  });

  it('apagado SIN vencimiento se queda apagado', () => {
    // Es lo que deja una derivación: hay una persona atendiendo y la IA no
    // puede volver sola a meterse en medio.
    expect(estaPausado({ botActivo: false, pausadoHasta: null }, AHORA)).toBe(
      true,
    );
  });

  it('sin prospecto todavía, responde', () => {
    expect(estaPausado(null, AHORA)).toBe(false);
    expect(estaPausado(undefined, AHORA)).toBe(false);
  });
});

describe('debeReactivarse', () => {
  it('sí cuando la pausa temporal ya venció', () => {
    expect(
      debeReactivarse({ botActivo: false, pausadoHasta: enMinutos(-1) }, AHORA),
    ).toBe(true);
  });

  it('no mientras la pausa sigue corriendo', () => {
    expect(
      debeReactivarse({ botActivo: false, pausadoHasta: enMinutos(30) }, AHORA),
    ).toBe(false);
  });

  it('NUNCA reactiva una derivación', () => {
    expect(
      debeReactivarse({ botActivo: false, pausadoHasta: null }, AHORA),
    ).toBe(false);
  });

  it('no reactiva lo que ya está activo', () => {
    expect(
      debeReactivarse({ botActivo: true, pausadoHasta: null }, AHORA),
    ).toBe(false);
  });
});

describe('venceEn', () => {
  it('la pausa por intervención dura 2 horas, como pide el anexo', () => {
    expect(PAUSA_INTERVENCION_MS).toBe(2 * 60 * 60 * 1000);
    expect(venceEn(AHORA).getTime() - AHORA.getTime()).toBe(
      PAUSA_INTERVENCION_MS,
    );
  });
});
