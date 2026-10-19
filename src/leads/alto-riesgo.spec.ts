import { conIndicacionMedica, esAltoRiesgo, INDICACION_MEDICA } from './alto-riesgo';

describe('quién es de alto riesgo', () => {
  it.each([
    'tengo diabetes y tomo metformina',
    'soy hipertenso',
    'estoy tomando pastillas para la presión',
    'estoy embarazada, ¿puedo tomar moringa?',
    'estoy dando de lactar',
    'es para mi bebé de 8 meses',
    'tiene problemas del riñón',
  ])('"%s" sí', (t) => expect(esAltoRiesgo(t)).toBe(true));

  it.each([
    'busco algo para la gastritis',
    'quiero colágeno para las rodillas',
    'te lo agradezco de corazón',
    'mi mamá tiene 65 años',
  ])('"%s" no', (t) => expect(esAltoRiesgo(t)).toBe(false));
});

describe('la indicación médica', () => {
  it('se agrega si falta, aunque esté el descargo genérico', () => {
    const r = conIndicacionMedica(
      'Tenemos Diabetizan.\n\nAnte cualquier condición de salud, consulta a tu médico.',
    );
    expect(r.endsWith(INDICACION_MEDICA)).toBe(true);
  });

  it('no se repite si el modelo ya la dijo', () => {
    const t = 'Consúltalo con tu médico y no dejes tu tratamiento actual hasta que él te lo indique.';
    expect(conIndicacionMedica(t)).toBe(t);
  });
});
