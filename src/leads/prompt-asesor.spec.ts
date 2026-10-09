/**
 * C5 — el prompt del asesor.
 *
 * Lo que de verdad hay que proteger aquí: que la plantilla NO contenga nada de
 * Hierba Sana. El día que el prompt base mencione sus distritos o su nombre,
 * el siguiente cliente deja de ser onboarding y pasa a ser desarrollo.
 */
import { conDescargoLegal, promptDelAsesor } from './prompt-asesor';

const HIERBA_SANA = {
  nombre: 'Hierba Sana',
  rubro: 'productos naturales',
  asesor: 'Claudio',
  contexto: 'Tienda en el Mercado La Merced. Delivery en Lima S/ 15.',
};

describe('la plantilla sirve para cualquier negocio', () => {
  it('no menciona a ningún cliente concreto', () => {
    const generico = promptDelAsesor({ nombre: 'X', contexto: '' });
    for (const rastro of [
      'Hierba Sana',
      'Miraflores',
      'Shalom',
      'naturista',
      'Claudio',
      '15.00',
    ]) {
      expect(generico).not.toContain(rastro);
    }
  });

  it('inyecta el nombre, el rubro y el contexto del negocio', () => {
    const p = promptDelAsesor(HIERBA_SANA);
    expect(p).toContain('Hierba Sana');
    expect(p).toContain('productos naturales');
    expect(p).toContain('Mercado La Merced');
  });

  it('se presenta con el nombre configurado, una sola vez', () => {
    const p = promptDelAsesor(HIERBA_SANA);
    expect(p).toContain('preséntate como Claudio');
    expect(p).toContain('No vuelvas a presentarte');
  });

  it('sin nombre de asesor, no se inventa uno', () => {
    const p = promptDelAsesor({ nombre: 'Ferretería X', contexto: '' });
    expect(p).toContain('No te presentes con un nombre propio');
  });

  it('sin contexto cargado, avisa de que no puede afirmar nada', () => {
    // Si una empresa activa la IA sin cargar su información, lo peor sería
    // que improvisara precios y políticas.
    const p = promptDelAsesor({
      nombre: 'X',
      contexto: 'No hay información cargada del negocio: no afirmes nada.',
    });
    expect(p).toContain('no afirmes nada');
  });
});

describe('las reglas que no pueden faltar', () => {
  const p = promptDelAsesor(HIERBA_SANA);

  it.each([
    ['una pregunta por mensaje', 'UNA sola pregunta por mensaje'],
    ['nada de markdown que WhatsApp no entiende', 'Nada de #, tablas'],
    ['no inventar precios', 'Nada de memoria'],
    ['máximo dos preguntas antes de recomendar', 'DOS preguntas'],
    ['un "gracias" no es despedida', 'NO son una despedida'],
    ['no repetirse', 'No repitas un mensaje'],
    ['no insistir con el pago tras el pedido', 'ni insistas con el pago'],
  ])('incluye: %s', (_caso, fragmento) => {
    expect(p).toContain(fragmento);
  });
});

describe('conDescargoLegal', () => {
  const DESCARGO =
    'Este producto es un complemento alimenticio/natural y no reemplaza el diagnóstico ni el tratamiento médico profesional.';

  it('lo añade cuando el turno recomendó productos', () => {
    const r = conDescargoLegal('Te recomiendo la Moringa.', DESCARGO, true);
    expect(r).toContain(DESCARGO);
  });

  it('no lo añade si no se recomendó nada', () => {
    // Preguntar la dirección de la tienda no lleva descargo médico.
    const r = conDescargoLegal(
      'Estamos en Av. Emancipación 687.',
      DESCARGO,
      false,
    );
    expect(r).toBe('Estamos en Av. Emancipación 687.');
  });

  it('no lo duplica si el modelo ya lo escribió', () => {
    const respuesta = `Te recomiendo la Moringa.\n\n${DESCARGO}`;
    const r = conDescargoLegal(respuesta, DESCARGO, true);
    expect(r.split('complemento alimenticio')).toHaveLength(2);
  });

  it('lo reconoce aunque el modelo lo haya escrito sin tildes', () => {
    const sinTildes =
      'Este producto es un complemento alimenticio/natural y no reemplaza el diagnostico ni el tratamiento medico profesional.';
    const r = conDescargoLegal(`Mira esto.\n\n${sinTildes}`, DESCARGO, true);
    expect(r.split('complemento alimenticio')).toHaveLength(2);
  });

  it('sin descargo configurado no cambia nada', () => {
    expect(conDescargoLegal('Hola.', null, true)).toBe('Hola.');
    expect(conDescargoLegal('Hola.', '  ', true)).toBe('Hola.');
  });
});
