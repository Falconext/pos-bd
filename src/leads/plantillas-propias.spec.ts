/**
 * Plantillas propias: lo que se le manda a Meta y lo que le llega al cliente.
 *
 * Se cuida que las variables con nombre se traduzcan en el orden correcto
 * ({{dato1}} antes que {{nombre}} da {{1}}=dato1), que el pie de baja vaya
 * siempre en marketing, y que lo que Meta rechazaría se diga antes de mandar.
 */
import {
  PIE_BAJA,
  cuerpoParaMeta,
  erroresDe,
  estadoDesdeMeta,
  motivoRechazo,
  nombreMetaDe,
  normalizarPlantilla,
  parametrosDeEnvio,
  payloadAltaMeta,
  primerNombre,
  textoRenderizado,
} from './plantillas-propias';

const valida = (cambios: Record<string, unknown> = {}) =>
  normalizarPlantilla({
    titulo: 'Cyber',
    categoria: 'MARKETING',
    cuerpo:
      'Hola {{nombre}}, este fin de semana tenemos {{dato1}} en toda la tienda.',
    ejemplos: { dato1: '20% de descuento' },
    ...cambios,
  });

describe('normalizarPlantilla', () => {
  it('en marketing el pie es el de la baja, aunque escriban otro', () => {
    expect(valida({ pie: 'Gracias' }).pie).toBe(PIE_BAJA);
  });

  it('en utilidad el pie es libre y opcional', () => {
    expect(valida({ categoria: 'UTILITY', pie: 'Tienda Bulldog' }).pie).toBe(
      'Tienda Bulldog',
    );
    expect(valida({ categoria: 'UTILITY' }).pie).toBeNull();
  });

  it('una categoría desconocida cae en marketing (la que lleva baja)', () => {
    expect(valida({ categoria: 'AUTHENTICATION' }).categoria).toBe('MARKETING');
  });
});

describe('erroresDe', () => {
  it('una plantilla correcta no tiene errores', () => {
    expect(erroresDe(valida())).toEqual([]);
  });

  it('variable inventada', () => {
    expect(
      erroresDe(
        valida({
          cuerpo: 'Hola {{nombre}}, el {{precio}} bajó mucho esta semana.',
        }),
      ).join(' '),
    ).toMatch(/\{\{precio\}\}/);
  });

  it('empezar o terminar con variable', () => {
    expect(
      erroresDe(
        valida({ cuerpo: '{{nombre}} tenemos ofertas nuevas para ti hoy' }),
      ).join(' '),
    ).toMatch(/empiecen o terminen/);
    expect(
      erroresDe(
        valida({ cuerpo: 'Tenemos ofertas nuevas para ti hoy {{nombre}}' }),
      ).join(' '),
    ).toMatch(/empiecen o terminen/);
  });

  it('dato1 sin ejemplo', () => {
    expect(erroresDe(valida({ ejemplos: {} })).join(' ')).toMatch(
      /ejemplo de lo que irá en \{\{dato1\}\}/,
    );
  });

  it('botones: más de 3 respuestas, enlace sin https y textos repetidos', () => {
    const e = erroresDe(
      valida({
        botones: [
          { tipo: 'RESPUESTA', texto: 'Sí' },
          { tipo: 'RESPUESTA', texto: 'No' },
          { tipo: 'RESPUESTA', texto: 'Tal vez' },
          { tipo: 'RESPUESTA', texto: 'sí' },
          { tipo: 'URL', texto: 'Ver', url: 'http://inseguro.com' },
        ],
      }),
    ).join(' ');
    expect(e).toMatch(/Hasta 3 botones/);
    expect(e).toMatch(/https:\/\//);
    expect(e).toMatch(/mismo texto/);
  });

  it('imagen de cabecera sin subir', () => {
    expect(erroresDe(valida({ cabeceraTipo: 'IMAGEN' })).join(' ')).toMatch(
      /Sube la imagen/,
    );
  });
});

describe('traducción a Meta', () => {
  it('numera en orden de aparición y repite el mismo número', () => {
    expect(
      cuerpoParaMeta(
        'Tenemos {{dato1}} para ti {{nombre}}, solo hoy {{dato1}}.',
      ),
    ).toEqual({
      texto: 'Tenemos {{1}} para ti {{2}}, solo hoy {{1}}.',
      orden: ['dato1', 'nombre'],
    });
  });

  it('el alta lleva ejemplos, pie y botones con las respuestas primero', () => {
    const p = valida({
      botones: [
        { tipo: 'URL', texto: 'Ver catálogo', url: 'https://tienda.pe' },
        { tipo: 'RESPUESTA', texto: 'Lo quiero' },
      ],
    });
    const alta = payloadAltaMeta(p, 'cyber_abc') as any;
    expect(alta).toMatchObject({
      name: 'cyber_abc',
      language: 'es',
      category: 'MARKETING',
    });
    expect(alta.components[0]).toEqual({
      type: 'BODY',
      text: 'Hola {{1}}, este fin de semana tenemos {{2}} en toda la tienda.',
      example: { body_text: [['María', '20% de descuento']] },
    });
    expect(alta.components[1]).toEqual({ type: 'FOOTER', text: PIE_BAJA });
    expect(alta.components[2].buttons.map((b: any) => b.type)).toEqual([
      'QUICK_REPLY',
      'URL',
    ]);
  });

  it('nombre en Meta: minúsculas, sin tildes, con sufijo', () => {
    expect(nombreMetaDe('¡Cyber Wow! Fragancias árabes', 'a1b2')).toBe(
      'cyber_wow_fragancias_arabes_a1b2',
    );
  });
});

describe('lo que le llega al cliente', () => {
  it('parámetros en el orden de Meta, con el primer nombre', () => {
    expect(
      parametrosDeEnvio('Hola {{nombre}}, tenemos {{dato1}}.', {
        nombre: 'rosa quispe',
        dato1: '2x1',
      }),
    ).toEqual(['Rosa', '2x1']);
  });

  it('sin nombre conocido (o un @usuario) dice "cliente"', () => {
    expect(primerNombre(null)).toBe('cliente');
    expect(primerNombre('@rosita_q')).toBe('cliente');
    expect(primerNombre('51987654321')).toBe('cliente');
  });

  it('un dato vacío no se manda vacío (Meta lo rechaza)', () => {
    expect(
      parametrosDeEnvio('Hola {{nombre}}, tenemos {{dato1}}.', {
        nombre: 'Ana',
      }),
    ).toEqual(['Ana', '-']);
  });

  it('el texto plano lleva cabecera, cuerpo y pie', () => {
    const p = valida({ cabeceraTipo: 'TEXTO', cabeceraTexto: 'Cyber Wow' });
    expect(textoRenderizado(p, { nombre: 'Ana', dato1: '20%' })).toBe(
      `*Cyber Wow*\n\nHola Ana, este fin de semana tenemos 20% en toda la tienda.\n\n${PIE_BAJA}`,
    );
  });
});

describe('estados de Meta', () => {
  it('traduce los estados y motivos', () => {
    expect(estadoDesdeMeta('APPROVED')).toBe('APROBADA');
    expect(estadoDesdeMeta('IN_APPEAL')).toBe('PENDIENTE');
    expect(estadoDesdeMeta('PAUSED')).toBe('PAUSADA');
    expect(motivoRechazo('NONE')).toBeNull();
    expect(motivoRechazo('PROMOTIONAL')).toMatch(/Marketing/);
  });
});
