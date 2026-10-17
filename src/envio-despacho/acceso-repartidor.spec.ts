/**
 * El enlace del repartidor: que sirva mientras lo necesita y se cierre después.
 *
 * Lo que se defiende acá es el equilibrio entre dos cosas que tiran en
 * sentidos opuestos: el motorizado tiene que poder marcar su entrega sin
 * cuenta ni contraseña, y ese mismo enlace muestra nombre, dirección y
 * teléfono de un cliente. Va a andar suelto en los WhatsApp de varios
 * repartidores, así que vence.
 */
import {
  VIGENCIA_TRAS_ENTREGA_MS,
  enlaceDeEntrega,
  enlaceVigente,
  nuevoTokenDeEntrega,
  puedeMarcar,
} from './acceso-repartidor';

const AHORA = new Date('2026-10-17T15:00:00Z');
const haceHoras = (h: number) => new Date(AHORA.getTime() - h * 3600_000);

describe('vigencia del enlace', () => {
  it('sirve mientras el pedido está en curso', () => {
    for (const estado of ['PREPARANDO', 'EN_CAMINO', 'EN_AGENCIA', 'EN_DESTINO']) {
      expect(enlaceVigente({ estado, entregadoEn: null }, AHORA)).toBe(true);
    }
  });

  it('sigue abierto el día después de entregar', () => {
    // Para la foto que se le quedó o la corrección de último momento.
    expect(
      enlaceVigente({ estado: 'ENTREGADO', entregadoEn: haceHoras(5) }, AHORA),
    ).toBe(true);
  });

  describe('lo que NO debe pasar', () => {
    it('se cierra pasadas las 24 horas de la entrega', () => {
      expect(
        enlaceVigente({ estado: 'ENTREGADO', entregadoEn: haceHoras(25) }, AHORA),
      ).toBe(false);
    });

    it('un pedido devuelto cierra el enlace: no hay nada que marcar', () => {
      expect(
        enlaceVigente({ estado: 'DEVUELTO', entregadoEn: null }, AHORA),
      ).toBe(false);
    });

    it('un entregado sin fecha no reabre el enlace', () => {
      // Son los despachos que ya existían cuando se agregó el campo.
      expect(
        enlaceVigente({ estado: 'ENTREGADO', entregadoEn: null }, AHORA),
      ).toBe(false);
    });

    it('un token que no resolvió a nada no abre nada', () => {
      expect(enlaceVigente(null, AHORA)).toBe(false);
      expect(enlaceVigente(undefined, AHORA)).toBe(false);
    });
  });

  it('el corte es exactamente a las 24 horas', () => {
    const justoAntes = new Date(AHORA.getTime() - VIGENCIA_TRAS_ENTREGA_MS + 1000);
    const justoDespues = new Date(AHORA.getTime() - VIGENCIA_TRAS_ENTREGA_MS);
    expect(
      enlaceVigente({ estado: 'ENTREGADO', entregadoEn: justoAntes }, AHORA),
    ).toBe(true);
    expect(
      enlaceVigente({ estado: 'ENTREGADO', entregadoEn: justoDespues }, AHORA),
    ).toBe(false);
  });
});

describe('qué puede marcar el repartidor', () => {
  it('que salió y que entregó, nada más', () => {
    expect(puedeMarcar('EN_CAMINO')).toBe(true);
    expect(puedeMarcar('ENTREGADO')).toBe(true);
  });

  it('devolver o reprogramar es decisión del negocio, no de la calle', () => {
    // Esas quedan en el panel, con el nombre de quién las tomó.
    for (const estado of ['DEVUELTO', 'PREPARANDO', 'EN_AGENCIA', '', 'borrar']) {
      expect(puedeMarcar(estado)).toBe(false);
    }
  });
});

describe('el token', () => {
  it('no es adivinable ni se repite', () => {
    // Es la única credencial del enlace: si se derivara del id del pedido,
    // cualquiera con el enlace de uno tendría el de todos.
    const tokens = new Set(Array.from({ length: 200 }, nuevoTokenDeEntrega));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t.length).toBeGreaterThanOrEqual(40);
  });

  it('viaja en una URL sin romperse', () => {
    // El enlace se pega en un WhatsApp: nada de +, / ni = que lo corten.
    for (let i = 0; i < 50; i++) {
      expect(nuevoTokenDeEntrega()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('arma el enlace sin barras repetidas', () => {
    expect(enlaceDeEntrega('https://app.krezka.com/', 'abc')).toBe(
      'https://app.krezka.com/entrega/abc',
    );
    expect(enlaceDeEntrega('https://app.krezka.com', 'abc')).toBe(
      'https://app.krezka.com/entrega/abc',
    );
  });
});
