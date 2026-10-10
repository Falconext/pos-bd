/**
 * A3 — no repetirse ni insistir tras la despedida.
 *
 * Los casos vienen del banco del cliente: pruebas 10, 12 y 14 del funcional y
 * E09–E11 del docx. El riesgo de estas reglas no es dejar pasar una
 * repetición: es cerrar una venta viva por confundir un "gracias" con un adiós.
 */
import {
  aportaDatoNuevo,
  esCortesiaBreve,
  esDespedidaClara,
  esRepetida,
  normalizar,
  similitudCoseno,
} from './leads-repeticion';

describe('normalizar', () => {
  it('quita tildes, mayúsculas, signos y emojis', () => {
    expect(normalizar('¡Muchas GRACIAS! 😊🌿')).toBe('muchas gracias');
  });

  it('conserva las palabras con ñ', () => {
    expect(normalizar('mañana')).toBe('manana');
  });

  it('deja vacío un mensaje de solo emojis', () => {
    expect(normalizar('👍👍')).toBe('');
  });
});

describe('esCortesiaBreve', () => {
  it.each(['gracias', 'Gracias!', 'ok', 'Listo 👍', 'muchas gracias', '😊'])(
    'reconoce "%s" como cortesía sin información nueva',
    (texto) => {
      expect(esCortesiaBreve(texto)).toBe(true);
    },
  );

  it.each([
    'gracias, y tienen moringa?',
    'ok dame el de 100 capsulas',
    'tengo dolor de rodillas',
    'si quiero',
  ])('no toma "%s" como simple cortesía', (texto) => {
    expect(esCortesiaBreve(texto)).toBe(false);
  });
});

describe('esDespedidaClara', () => {
  it.each([
    'gracias por la información',
    'no gracias',
    'eso es todo',
    'hasta luego',
    'ya no',
    'no me interesa',
  ])('cierra con "%s"', (texto) => {
    expect(esDespedidaClara(texto)).toBe(true);
  });

  it.each([
    // Venta en pausa, no cerrada: el banco espera recuperarla después.
    'lo voy a pensar',
    'después te aviso',
    'déjame consultar',
    // Un "gracias" suelto nunca cierra: lo dice el flujo del cliente.
    'gracias',
    'ok',
    // Las mismas palabras dentro de una frase larga no son una despedida.
    'ya no me acuerdo cuál pedí la vez pasada, me ayudas a revisarlo?',
  ])('NO cierra con "%s"', (texto) => {
    expect(esDespedidaClara(texto)).toBe(false);
  });
});

describe('similitudCoseno', () => {
  it('da 1 para el mismo vector', () => {
    expect(similitudCoseno([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('da 0 para vectores perpendiculares', () => {
    expect(similitudCoseno([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('da 0 si falta un vector o no coinciden en tamaño', () => {
    expect(similitudCoseno([], [1, 2])).toBe(0);
    expect(similitudCoseno([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe('esRepetida', () => {
  const base = [1, 0, 0];

  it('detecta una respuesta casi igual a una anterior', () => {
    expect(esRepetida([0.99, 0.1, 0], [base])).toBe(true);
  });

  it('deja pasar una respuesta que dice algo distinto', () => {
    expect(esRepetida([0, 1, 0], [base])).toBe(false);
  });

  it('sin respuestas anteriores nunca bloquea', () => {
    expect(esRepetida(base, [])).toBe(false);
  });
});

describe('aportaDatoNuevo', () => {
  it('detecta un precio que no estaba en las respuestas anteriores', () => {
    expect(
      aportaDatoNuevo('Harina de Moringa de 150 gr a S/ 10.00.', [
        'Moringa en cápsulas de 100 unidades a S/ 31.00.',
      ]),
    ).toBe(true);
  });

  it('no ve nada nuevo si repite las mismas cifras', () => {
    expect(
      aportaDatoNuevo('Te confirmo: Moringa 100 cápsulas, S/ 31.00.', [
        'Moringa en cápsulas de 100 unidades a S/ 31.00.',
      ]),
    ).toBe(false);
  });

  it('no ve nada nuevo en un mensaje sin cifras', () => {
    expect(
      aportaDatoNuevo('Quedo atento para ayudarte.', [
        'Estoy a tu disposición.',
      ]),
    ).toBe(false);
  });
});
