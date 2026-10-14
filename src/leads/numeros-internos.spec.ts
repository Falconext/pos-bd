/**
 * Lo que defiende este archivo es el embudo.
 *
 * En Hierba Sana, dos de las tres conversaciones del tablero eran pruebas del
 * propio dueño —una desde su número de supervisor— y aparecían como leads
 * calientes con puntaje 82 y 96. El empresario lo dijo así: "Estilo colecta
 * no debe figurar en el flujo".
 */
import {
  claveTelefono,
  esNumeroInterno,
  numerosInternos,
} from './numeros-internos';

describe('claveTelefono', () => {
  it('reconoce el mismo número escrito de las tres formas que hay en la base', () => {
    // El celular del usuario lo tecleó una persona; WhatsApp manda el
    // internacional; a mano aparece con espacios o con "+".
    const esperado = '955947892';
    for (const forma of [
      '955947892',
      '51955947892',
      '+51 955 947 892',
      '+51955947892',
      '955 947 892',
    ]) {
      expect(claveTelefono(forma)).toBe(esperado);
    }
  });

  it('no inventa una clave donde no hay número', () => {
    for (const vacio of ['', '   ', 'sin número', null, undefined]) {
      expect(claveTelefono(vacio)).toBe('');
    }
  });

  it('deja en paz un número más corto que 9 dígitos', () => {
    expect(claveTelefono('12345')).toBe('12345');
  });
});

describe('esNumeroInterno', () => {
  const internos = ['955947892', '51919755320'];

  it('el supervisor escribiendo desde su celular es interno', () => {
    // El caso real: conv 81, "Casa Naturista Hierba Sana", 51955947892.
    expect(esNumeroInterno('51955947892', internos)).toBe(true);
  });

  it('el número de pruebas configurado a mano también', () => {
    // "StiloColecta": no es usuario del sistema, pero es su prueba.
    expect(esNumeroInterno('51919755320', internos)).toBe(true);
  });

  it('un cliente de verdad NO es interno', () => {
    // Diego Ortega, conv 52. Si esto se rompe, se pierden leads reales.
    expect(esNumeroInterno('51991065217', internos)).toBe(false);
  });

  it('sin teléfono no es interno', () => {
    // Tratarlo como interno lo sacaría del embudo sin que nadie lo note.
    expect(esNumeroInterno('', internos)).toBe(false);
    expect(esNumeroInterno(null, internos)).toBe(false);
  });

  it('sin lista, nadie es interno', () => {
    expect(esNumeroInterno('51955947892', [])).toBe(false);
  });

  it('una lista con huecos no vuelve interno a cualquiera', () => {
    // Un celular vacío en la tabla de usuarios no puede coincidir con todos.
    expect(esNumeroInterno('51991065217', [null, '', undefined])).toBe(false);
  });
});

describe('numerosInternos', () => {
  it('junta los celulares de los admins con los configurados a mano', () => {
    expect(numerosInternos(['955947892'], ['51919755320'])).toEqual([
      '955947892',
      '919755320',
    ]);
  });

  it('no repite el mismo número escrito de dos formas', () => {
    expect(numerosInternos(['955947892'], ['+51 955 947 892'])).toEqual([
      '955947892',
    ]);
  });

  it('descarta los vacíos', () => {
    expect(numerosInternos([null, '', '955947892'], [undefined])).toEqual([
      '955947892',
    ]);
  });

  it('sin nada configurado, lista vacía', () => {
    expect(numerosInternos([], [])).toEqual([]);
  });
});
