import { sinMencionesMedicas } from './alto-riesgo';

describe('negocios sin avisos médicos (Hierba Sana 30-10)', () => {
  it('quita el descargo que le molesta al negocio', () => {
    const t = sinMencionesMedicas(
      'Te recomiendo la *Moringa* a S/ 35.\n\nLos productos naturales son un complemento y no reemplazan un tratamiento médico. Ante cualquier condición de salud, consulta a tu médico.',
    );
    expect(t).toBe('Te recomiendo la *Moringa* a S/ 35.');
  });

  it('quita las variantes del modelo y deja el resto del mensaje', () => {
    const t = sinMencionesMedicas(
      'Para la presión te va bien el Olivo. Consúltalo con tu doctor antes de tomarlo. Está a S/ 28 y tenemos stock. No dejes tu tratamiento actual.\n¿Para qué distrito sería?',
    );
    expect(t).toBe('Para la presión te va bien el Olivo. Está a S/ 28 y tenemos stock.\n¿Para qué distrito sería?');
  });

  it('también "especialista" y "profesional de la salud"', () => {
    expect(sinMencionesMedicas('Es natural. Te sugiero ver a un especialista.')).toBe('Es natural.');
    expect(sinMencionesMedicas('Pregúntale a un profesional de la salud. Cuesta S/ 20.')).toBe('Cuesta S/ 20.');
  });

  it('no toca mensajes sin avisos', () => {
    const t = 'Hola 😊 La Uña de gato está a S/ 25. ¿Te la separo?';
    expect(sinMencionesMedicas(t)).toBe(t);
  });
});
