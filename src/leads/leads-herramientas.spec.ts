/**
 * A1 — la IA consulta el catálogo en vez de improvisar.
 *
 * Lo que se valida: que el historial que le mandamos a Gemini sea uno que
 * acepta (empieza en el cliente, sin dos turnos seguidos del mismo lado), que
 * el ciclo pedido → ejecución → resultado termine en una respuesta de texto, y
 * que un fallo de una herramienta no deje al cliente sin contestación.
 */
import { GeminiService, TurnoGemini } from '../gemini/gemini.service';

/** GeminiService sin tocar la red: solo nos interesa la normalización. */
const servicioSinApiKey = () =>
  new GeminiService({ get: () => undefined } as any);

describe('normalizarHistorial', () => {
  it('funde los mensajes seguidos del cliente en un solo turno', () => {
    const gemini = servicioSinApiKey();
    const turnos: TurnoGemini[] = [
      { role: 'user', content: 'hola' },
      { role: 'user', content: 'tienen berberina?' },
      { role: 'user', content: 'y cuanto cuesta' },
    ];
    expect(gemini.normalizarHistorial(turnos)).toEqual([
      { role: 'user', content: 'hola\ntienen berberina?\ny cuanto cuesta' },
    ]);
  });

  it('descarta los turnos nuestros que abren la conversación', () => {
    // Pasa de verdad cuando un disparador escribe primero.
    const gemini = servicioSinApiKey();
    const turnos: TurnoGemini[] = [
      { role: 'model', content: 'Hola, ¿sigues interesado?' },
      { role: 'user', content: 'sí' },
    ];
    expect(gemini.normalizarHistorial(turnos)).toEqual([
      { role: 'user', content: 'sí' },
    ]);
  });

  it('respeta una conversación que ya alterna bien', () => {
    const gemini = servicioSinApiKey();
    const turnos: TurnoGemini[] = [
      { role: 'user', content: 'hola' },
      { role: 'model', content: '¿en qué te ayudo?' },
      { role: 'user', content: 'moringa' },
    ];
    expect(gemini.normalizarHistorial(turnos)).toEqual(turnos);
  });

  it('ignora los mensajes vacíos', () => {
    const gemini = servicioSinApiKey();
    const turnos: TurnoGemini[] = [
      { role: 'user', content: '  ' },
      { role: 'user', content: 'moringa' },
    ];
    expect(gemini.normalizarHistorial(turnos)).toEqual([
      { role: 'user', content: 'moringa' },
    ]);
  });
});

/**
 * Doble del modelo de Gemini: devuelve los turnos que se le programen. Cada
 * entrada es o una lista de llamadas a herramientas, o un texto final.
 *
 * Se dobla `generateContent` y no `startChat` a propósito: el SDK 0.21 manda
 * los resultados de herramienta con rol "function" y el endpoint v1beta los
 * rechaza con un 400, así que los turnos se arman a mano. `enviados` guarda
 * los `contents` de cada llamada para poder mirarlos.
 */
function modeloFalso(turnos: ({ calls: any[] } | { text: string })[]) {
  const enviados: any[][] = [];
  let i = 0;
  return {
    enviados,
    generateContent: jest.fn(async ({ contents }: any) => {
      enviados.push(contents.map((c: any) => ({ ...c })));
      const t = turnos[Math.min(i++, turnos.length - 1)];
      const calls = 'calls' in t ? t.calls : undefined;
      return {
        response: {
          functionCalls: () => calls,
          candidates: calls
            ? [
                {
                  content: {
                    role: 'model',
                    parts: calls.map((c) => ({ functionCall: c })),
                  },
                },
              ]
            : [
                {
                  content: {
                    role: 'model',
                    parts: [{ text: (t as any).text }],
                  },
                },
              ],
          text: () => {
            if ('text' in t) return t.text;
            throw new Error('sin parte de texto');
          },
        },
      };
    }),
  };
}

function geminiConModelo(falso: { generateContent: any }) {
  const gemini = servicioSinApiKey();
  (gemini as any).genAI = { getGenerativeModel: () => falso };
  return gemini;
}

describe('chatConHerramientas', () => {
  const declaraciones = [{ name: 'buscar_productos' }] as any;

  it('ejecuta lo que pide el modelo y devuelve su respuesta final', async () => {
    const falso = modeloFalso([
      {
        calls: [{ name: 'buscar_productos', args: { consulta: 'berberina' } }],
      },
      { text: 'Sí, tenemos Berberina a S/ 45.00.' },
    ]);
    const gemini = geminiConModelo(falso);
    const ejecutor = jest
      .fn()
      .mockResolvedValue({ productos: [{ id: 1, nombre: 'Berberina' }] });

    const res = await gemini.chatConHerramientas(
      'prompt',
      [{ role: 'user', content: 'tienen berberina?' }],
      declaraciones,
      ejecutor,
    );

    expect(ejecutor).toHaveBeenCalledWith('buscar_productos', {
      consulta: 'berberina',
    });
    expect(res.texto).toBe('Sí, tenemos Berberina a S/ 45.00.');
    expect(res.llamadas).toEqual([
      {
        nombre: 'buscar_productos',
        argumentos: { consulta: 'berberina' },
        resultado: { productos: [{ id: 1, nombre: 'Berberina' }] },
      },
    ]);
  });

  it('le pasa el fallo de una herramienta al modelo en vez de cortarse', async () => {
    const falso = modeloFalso([
      { calls: [{ name: 'buscar_productos', args: { consulta: 'x' } }] },
      { text: 'Permíteme confirmarlo con un asesor.' },
    ]);
    const gemini = geminiConModelo(falso);
    const ejecutor = jest.fn().mockRejectedValue(new Error('timeout de BD'));

    const res = await gemini.chatConHerramientas(
      'prompt',
      [{ role: 'user', content: 'hola' }],
      declaraciones,
      ejecutor,
    );

    expect(res.texto).toBe('Permíteme confirmarlo con un asesor.');
    expect(res.llamadas[0].resultado).toEqual({ error: 'timeout de BD' });
  });

  it('envuelve en objeto un resultado que no lo es (Gemini lo exige)', async () => {
    const falso = modeloFalso([
      { calls: [{ name: 'buscar_productos', args: {} }] },
      { text: 'listo' },
    ]);
    const gemini = geminiConModelo(falso);

    await gemini.chatConHerramientas(
      'prompt',
      [{ role: 'user', content: 'hola' }],
      declaraciones,
      jest.fn().mockResolvedValue([1, 2, 3]),
    );

    const contents = falso.enviados[1];
    const ultimo = contents[contents.length - 1];
    // Va como turno del usuario: el rol "function" del SDK da 400.
    expect(ultimo.role).toBe('user');
    expect(ultimo.parts[0].functionResponse.response).toEqual({
      resultado: [1, 2, 3],
    });
  });

  it('corta el bucle y fuerza una respuesta si el modelo no deja de pedir herramientas', async () => {
    // Siempre pide, nunca responde: sin el corte el cliente se queda sin nada.
    const falso = modeloFalso([
      { calls: [{ name: 'buscar_productos', args: {} }] },
      { calls: [{ name: 'buscar_productos', args: {} }] },
      { calls: [{ name: 'buscar_productos', args: {} }] },
      { calls: [{ name: 'buscar_productos', args: {} }] },
      { calls: [{ name: 'buscar_productos', args: {} }] },
      { text: 'Te comparto lo que encontré.' },
    ]);
    const gemini = geminiConModelo(falso);

    const res = await gemini.chatConHerramientas(
      'prompt',
      [{ role: 'user', content: 'hola' }],
      declaraciones,
      jest.fn().mockResolvedValue({ productos: [] }),
      { maxIteraciones: 4 },
    );

    expect(res.llamadas).toHaveLength(4);
    expect(res.texto).toBe('Te comparto lo que encontré.');
  });

  it('no acepta un historial cuyo último turno no sea del cliente', async () => {
    const gemini = geminiConModelo(modeloFalso([{ text: 'x' }]));
    await expect(
      gemini.chatConHerramientas(
        'prompt',
        [
          { role: 'user', content: 'hola' },
          { role: 'model', content: '¿en qué te ayudo?' },
        ],
        declaraciones,
        jest.fn(),
      ),
    ).rejects.toThrow(/último turno sea del usuario/);
  });
});
