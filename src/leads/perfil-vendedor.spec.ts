/**
 * "Mi vendedor" (22-10): el dueño configura tono, reglas, saludo, temas,
 * zonas y medios de pago desde el panel, sin redactar un prompt.
 *
 * Lo que hay que proteger: que un negocio SIN perfil tenga el prompt de
 * siempre, que lo del dueño mande sobre la plantilla, y que guardar desde la
 * pantalla no rompa lo que ya usan el flujo del pedido y los vouchers.
 */
import { promptDelAsesor } from './prompt-asesor';
import {
  bloquePerfil,
  envioValido,
  mediosPagoValidos,
  perfilValido,
  textoConocimiento,
  textoMediosPago,
} from './perfil-vendedor';
import { extraerTitular } from './voucher-verificacion';

const CAFE = { nombre: 'Café de Alba', rubro: 'cafetería', contexto: 'Café de origen peruano.' };

describe('sin perfil, el prompt no cambia', () => {
  it('perfil vacío o ausente da exactamente el mismo prompt', () => {
    const base = promptDelAsesor(CAFE);
    expect(promptDelAsesor({ ...CAFE, perfil: {} })).toBe(base);
    expect(promptDelAsesor({ ...CAFE, perfil: null })).toBe(base);
    expect(base).not.toContain('TU ESTILO EN ESTE NEGOCIO');
  });
});

describe('el perfil entra al prompt', () => {
  const perfil = perfilValido({
    audiencia: 'Amantes del café de especialidad',
    reglas: 'NUNCA recomiendes café molido para espresso.',
    estiloComunicacion: 'Cálido, como un barista experto',
    estiloVentas: 'Primero entiende el gusto, luego recomienda',
    longitud: 2,
    emojis: false,
    signosApertura: false,
    palabrasEvitar: ['asistente virtual', 'oferta imperdible'],
    mensajeBienvenida: 'Hola! Soy Ana de Café de Alba ☕ Buscas café para casa u oficina?',
    mensajeDerivacion: 'Te paso con una persona del equipo, un momento.',
  });
  const p = promptDelAsesor({ ...CAFE, asesor: 'Ana', perfil });

  it('trae cada campo del dueño', () => {
    for (const t of [
      'Amantes del café de especialidad',
      'NUNCA recomiendes café molido',
      'barista experto',
      'Primero entiende el gusto',
      'No uses emojis.',
      'No uses los signos de apertura',
      '"asistente virtual", "oferta imperdible"',
      'Soy Ana de Café de Alba',
      'Te paso con una persona del equipo',
    ]) {
      expect(p).toContain(t);
    }
  });

  it('va después de las reglas de la plantilla y antes del contexto, y dice que manda', () => {
    const estilo = p.indexOf('TU ESTILO EN ESTE NEGOCIO');
    expect(estilo).toBeGreaterThan(p.indexOf('CUÁNDO CALLARTE'));
    expect(estilo).toBeLessThan(p.indexOf('CONTEXTO DEL NEGOCIO'));
    expect(p).toContain('si choca con algo de arriba, vale esto');
  });

  it('el largo elegido se traduce en una instrucción concreta', () => {
    expect(bloquePerfil({ longitud: 1 })).toContain('una o dos líneas');
    expect(bloquePerfil({ longitud: 5 })).toContain('Muy detallado');
  });

  it('con emojis permitidos, solo esos', () => {
    expect(bloquePerfil({ emojis: true, emojisPermitidos: ['☕', '🌱'] })).toContain('solo estos');
    // Apagar los emojis gana sobre la paleta.
    expect(bloquePerfil({ emojis: false, emojisPermitidos: ['☕'] })).not.toContain('☕');
  });
});

describe('base de conocimiento por tema', () => {
  it('los temas entran al contexto con su categoría', () => {
    const perfil = perfilValido({
      conocimiento: [
        { categoria: 'HORARIOS', titulo: 'Atención', texto: 'L-S de 9am a 9pm' },
        { categoria: 'DEVOLUCIONES', titulo: 'Cambios', texto: 'Hasta 7 días con boleta' },
      ],
    });
    const p = promptDelAsesor({ ...CAFE, perfil });
    const contexto = p.slice(p.indexOf('CONTEXTO DEL NEGOCIO'));
    expect(contexto).toContain('Café de origen peruano.');
    expect(contexto).toContain('Horarios · Atención: L-S de 9am a 9pm');
    expect(contexto).toContain('Devoluciones · Cambios: Hasta 7 días con boleta');
    // El texto general va primero y queda intacto; los temas, después y mandan.
    expect(contexto.indexOf('Café de origen peruano.')).toBeLessThan(contexto.indexOf('POR TEMA'));
    expect(contexto).toContain('vale esto');
  });

  it('descarta temas sin título o sin texto, y la categoría desconocida va a Otros', () => {
    const perfil = perfilValido({
      conocimiento: [
        { categoria: 'PRODUCTOS', titulo: '', texto: 'algo' },
        { categoria: 'PRODUCTOS', titulo: 'Solo título', texto: '   ' },
        { categoria: 'INVENTADA', titulo: 'Promos', texto: '20% los lunes' },
      ],
    });
    expect(perfil.conocimiento).toEqual([
      { categoria: 'OTROS', titulo: 'Promos', texto: '20% los lunes' },
    ]);
    expect(textoConocimiento({})).toBe('');
  });
});

describe('perfilValido limpia lo que llega del panel', () => {
  it('ignora tipos raros, recorta espacios y quita palabras repetidas', () => {
    const p = perfilValido({
      audiencia: '   ',
      reglas: 42,
      longitud: 9,
      emojis: 'si',
      palabrasEvitar: ['caro', ' Caro ', '', 7, 'barato'],
    });
    expect(p).toEqual({ palabrasEvitar: ['caro', 'barato'] });
  });

  it('basura entera da perfil vacío', () => {
    expect(perfilValido(null)).toEqual({});
    expect(perfilValido('hola')).toEqual({});
  });
});

describe('zonas de envío desde el panel', () => {
  it('conserva los alias de cada lugar, que el panel no edita', () => {
    const envio = envioValido({
      zonas: [
        {
          nombre: 'Lima',
          tipo: 'DOMICILIO',
          tarifa: '15',
          lugares: [{ nombre: 'San Juan de Lurigancho', alias: ['SJL'] }, 'Miraflores'],
          courier: 'PROPIOS',
        },
      ],
      zonaPorDefecto: 'Lima',
    });
    expect(envio.zonas[0]).toEqual({
      nombre: 'Lima',
      tipo: 'DOMICILIO',
      tarifa: 15,
      lugares: [{ nombre: 'San Juan de Lurigancho', alias: ['SJL'] }, { nombre: 'Miraflores' }],
      courier: 'PROPIOS',
    });
    expect(envio.zonaPorDefecto).toBe('Lima');
  });

  it('la zona por defecto tiene que existir, y no se repiten nombres', () => {
    const envio = envioValido({
      zonas: [
        { nombre: 'Lima', tipo: 'DOMICILIO', tarifa: 10 },
        { nombre: 'lima', tipo: 'AGENCIA', tarifa: 20 },
        { nombre: 'Provincia', tipo: 'RARO', tarifa: -5 },
      ],
      zonaPorDefecto: 'Marte',
    });
    expect(envio.zonas.map((z) => [z.nombre, z.tipo, z.tarifa])).toEqual([
      ['Lima', 'DOMICILIO', 10],
      ['Provincia', 'DOMICILIO', 0],
    ]);
    expect(envio.zonaPorDefecto).toBe('');
  });
});

describe('medios de pago', () => {
  it('el texto guardado sigue sirviendo para verificar vouchers', () => {
    const medios = mediosPagoValidos([
      { nombre: 'Yape', detalle: '987 654 321', titular: 'María Pía Torres' },
      { nombre: 'BCP', detalle: '191-1234567-0-12' },
      { nombre: '', detalle: 'sin nombre se descarta' },
    ]);
    const texto = textoMediosPago(medios);
    expect(texto).toBe('Yape: 987 654 321 (titular: María Pía Torres) · BCP: 191-1234567-0-12');
    expect(extraerTitular(texto)).toBe('María Pía Torres');
  });
});
