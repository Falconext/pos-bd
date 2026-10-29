/**
 * Krezka 28-10: el saludo escrito en "Mi vendedor" la IA lo reescribía. El
 * menú lo manda tal cual, con preguntas para tocar, antes de la IA.
 */
import {
  HERRAMIENTA_MENU,
  bloqueRespuestasMenu,
  estadoDelMenu,
  mensajeDelPaso,
  menuValido,
  opcionElegida,
  respuestasDelMenu,
  textoConOpciones,
} from './menu-inicial';

const BIENVENIDA = '¡Hola! 👋 Bienvenido(a) a KREZKA 🚀';

const MENU = menuValido({
  activo: true,
  bienvenida: BIENVENIDA,
  pasos: [
    {
      pregunta: '¿Qué deseas mejorar primero?',
      opciones: [
        { titulo: 'Facturación electrónica', descripcion: 'Boletas y facturas SUNAT' },
        { titulo: 'Inventario y stock' },
        { titulo: 'Envíos Shalom / Olva' },
        { titulo: 'Hablar con un asesor', derivar: true },
      ],
    },
    {
      pregunta: '¿Dónde vendes hoy?',
      opciones: [{ titulo: '🏪 Tienda física' }, { titulo: '🌐 Por internet' }, { titulo: '🔁 Ambas' }],
    },
  ],
});

const marca = (paso: number) => [{ nombre: HERRAMIENTA_MENU, argumentos: { paso } }];

describe('menuValido', () => {
  it('descarta preguntas con menos de dos opciones y recorta a los límites de WhatsApp', () => {
    const m = menuValido({
      activo: true,
      pasos: [
        { pregunta: 'Sola', opciones: [{ titulo: 'Una' }] },
        { pregunta: 'Larga', opciones: [{ titulo: 'x'.repeat(40) }, { titulo: 'B' }] },
      ],
    });
    expect(m.pasos).toHaveLength(1);
    expect(m.pasos[0].opciones[0].titulo).toHaveLength(24);
  });

  it('sin preguntas válidas queda apagado aunque digan activo', () => {
    expect(menuValido({ activo: true, bienvenida: 'Hola', pasos: [] }).activo).toBe(false);
    expect(menuValido(null)).toEqual({ activo: false, bienvenida: '', pasos: [] });
  });
});

describe('mensajeDelPaso', () => {
  it('el primer paso lleva el saludo exacto arriba de la pregunta', () => {
    const m = mensajeDelPaso(MENU, 0);
    expect(m.cuerpo).toBe(`${BIENVENIDA}\n\n¿Qué deseas mejorar primero?`);
  });

  it('más de 3 opciones o con descripción → lista; 3 cortas → botones', () => {
    expect(mensajeDelPaso(MENU, 0).tipo).toBe('lista');
    const p2 = mensajeDelPaso(MENU, 1);
    expect(p2.tipo).toBe('botones');
    expect(p2.cuerpo).toBe('¿Dónde vendes hoy?');
  });

  it('como texto, las opciones van numeradas (Instagram, Messenger, historial)', () => {
    expect(textoConOpciones(mensajeDelPaso(MENU, 1))).toBe(
      '¿Dónde vendes hoy?\n\n1. 🏪 Tienda física\n2. 🌐 Por internet\n3. 🔁 Ambas',
    );
  });
});

describe('opcionElegida', () => {
  const paso = MENU.pasos[1];
  it.each([
    ['🌐 Por internet', 1], // tocó el botón: llega el título exacto
    ['por internet', 1],
    ['Por internet nomás', 1],
    ['2', 1],
    ['ambas', 2],
    ['tienda fisica', 0],
  ])('"%s" → opción %d', (r, j) => {
    expect(opcionElegida(paso, r)).toBe(j);
  });

  it.each(['cuánto cuesta?', '7', '', 'hola'])('"%s" no es una opción', (r) => {
    expect(opcionElegida(paso, r)).toBeNull();
  });
});

describe('estadoDelMenu', () => {
  it('sin mensajes nuestros → empieza', () => {
    expect(estadoDelMenu([{ rol: 'USUARIO', contenido: 'Hola, quiero más información' }])).toEqual({
      accion: 'empezar',
    });
  });

  it('lo último nuestro es un paso → el cliente le está respondiendo', () => {
    expect(
      estadoDelMenu([
        { rol: 'USUARIO', contenido: 'Hola' },
        { rol: 'ASISTENTE', contenido: '…', herramientasJson: marca(0) },
        { rol: 'USUARIO', contenido: 'Inventario y stock' },
      ]),
    ).toEqual({ accion: 'responder', paso: 0 });
  });

  it('ya contestó la IA, o es una conversación de antes del menú → sigue la IA', () => {
    expect(
      estadoDelMenu([
        { rol: 'USUARIO', contenido: 'Hola' },
        { rol: 'ASISTENTE', contenido: 'Hola! En qué te ayudo?' },
        { rol: 'USUARIO', contenido: 'precio' },
      ]),
    ).toEqual({ accion: 'ia' });
  });
});

describe('respuestas para la IA', () => {
  it('junta cada pregunta con lo que eligió y le pide no repetirlas', () => {
    const r = respuestasDelMenu(MENU, [
      { rol: 'USUARIO', contenido: 'Hola, quiero más información' },
      { rol: 'ASISTENTE', contenido: '…', herramientasJson: marca(0) },
      { rol: 'USUARIO', contenido: 'Envíos Shalom / Olva' },
      { rol: 'ASISTENTE', contenido: '…', herramientasJson: marca(1) },
      { rol: 'USUARIO', contenido: '🌐 Por internet' },
    ]);
    expect(r).toEqual([
      { pregunta: '¿Qué deseas mejorar primero?', respuesta: 'Envíos Shalom / Olva' },
      { pregunta: '¿Dónde vendes hoy?', respuesta: '🌐 Por internet' },
    ]);
    const bloque = bloqueRespuestasMenu(r);
    expect(bloque).toContain('No lo vuelvas a saludar');
    expect(bloque).toContain('¿Dónde vendes hoy? → 🌐 Por internet');
  });

  it('sin menú en la conversación, no agrega nada al prompt', () => {
    expect(bloqueRespuestasMenu([])).toBe('');
  });
});
