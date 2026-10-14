/**
 * QA funcional contra Gemini de verdad: los dos reclamos del cliente.
 *
 *   "No deriva a ofrecer más productos."
 *   "Sobre el registro sanitario aún no se defiende para continuar el chat.
 *    Lo derivó en una al supervisor."
 *
 * No es un test unitario y no corre en CI: necesita GEMINI_API_KEY y cuesta
 * tokens. Se corre a mano con QA_IA=1 cuando se toca el prompt del asesor,
 * porque lo que hay que comprobar es el COMPORTAMIENTO del modelo, y eso no
 * lo demuestra ninguna aserción sobre el texto del prompt.
 */
// Jest no carga el .env del backend y la clave vive ahí.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();
import { readFileSync } from 'fs';
import { GeminiService } from '../../gemini/gemini.service';
import { promptDelAsesor } from '../prompt-asesor';
import {
  HERRAMIENTAS_VENTA,
  INSTRUCCION_HERRAMIENTAS,
  HERRAMIENTA_BUSCAR_PRODUCTOS,
  HERRAMIENTA_DERIVAR,
} from '../leads-herramientas';
import { motivoDerivacionValido } from '../pausa-bot';

const correr = process.env.QA_IA === '1' ? describe : describe.skip;

const CONTEXTO = readFileSync(
  process.env.QA_CONTEXTO ?? '/dev/null',
  'utf-8',
);

/** Catálogo mínimo, con la forma que devuelve el ejecutor real. */
const CATALOGO = [
  { id: 1, nombre: 'Moringa en cápsulas 500 mg x 100', precio: 35, stock: 40,
    para: 'energía, defensas, control de azúcar' },
  { id: 2, nombre: 'Omega 3 1000 mg x 100 cápsulas', precio: 45, stock: 25,
    para: 'colesterol, triglicéridos, salud cardiovascular' },
  { id: 3, nombre: 'Alcachofa en cápsulas x 100', precio: 28, stock: 30,
    para: 'hígado graso, digestión, colesterol' },
  { id: 4, nombre: 'Psyllium husk 300 g', precio: 32, stock: 18,
    para: 'estreñimiento, fibra, colesterol' },
];

function armarEjecutor(registro: { nombre: string; args: any }[]) {
  return async (nombre: string, args: Record<string, unknown>) => {
    registro.push({ nombre, args });
    if (nombre === HERRAMIENTA_BUSCAR_PRODUCTOS) {
      const q = String(args.consulta ?? '').toLowerCase();
      const hits = CATALOGO.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          p.para.toLowerCase().split(/[ ,]+/).some((t) => q.includes(t)),
      );
      return { productos: (hits.length ? hits : CATALOGO).slice(0, 4) };
    }
    if (nombre === HERRAMIENTA_DERIVAR) {
      return { derivado: true, instruccion: 'Avísale que ya informaste a un asesor.' };
    }
    return { ok: true };
  };
}

async function turno(
  gemini: GeminiService,
  turnos: { role: 'user' | 'model'; content: string }[],
) {
  const registro: { nombre: string; args: any }[] = [];
  const res = await gemini.chatConHerramientas(
    `${promptDelAsesor({
      nombre: 'Hierba Sana',
      rubro: 'productos naturales',
      asesor: 'Claudio',
      contexto: CONTEXTO,
    })}\n\n${INSTRUCCION_HERRAMIENTAS}`,
    turnos,
    HERRAMIENTAS_VENTA,
    armarEjecutor(registro) as never,
    { maxOutputTokens: 800 },
  );
  return { texto: res.texto, registro };
}

correr('QA en vivo del asesor', () => {
  jest.setTimeout(180_000);
  let gemini: GeminiService;
  beforeAll(() => {
    gemini = new GeminiService({
      get: (k: string) => process.env[k],
    } as never);
  });

  it('CASO 1 — una pregunta por el registro sanitario NO se deriva', async () => {
    const { texto, registro } = await turno(gemini, [
      { role: 'user', content: 'Hola, quiero la moringa en cápsulas' },
      {
        role: 'model',
        content:
          'Hola, soy Claudio de Hierba Sana 😊 La *Moringa en cápsulas 500 mg x 100* está a S/ 35.00 y tenemos stock. ¿Para qué distrito sería la entrega?',
      },
      {
        role: 'user',
        content: '¿Y eso tiene registro sanitario? No quiero comprar cualquier cosa',
      },
    ]);
    console.log('\n[CASO 1] respuesta:\n' + texto);
    console.log('[CASO 1] herramientas:', registro.map((r) => r.nombre));

    const derivaciones = registro.filter((r) => r.nombre === HERRAMIENTA_DERIVAR);
    expect(derivaciones).toHaveLength(0);
    expect(texto.toLowerCase()).toMatch(/registro sanitario/);
    // Y sigue atendiendo: no se despide ni anuncia un asesor.
    expect(texto.toLowerCase()).not.toMatch(/asesor (se )?(comunicar|contactar)/);
  });

  it('CASO 2 — insistiendo por el NÚMERO de registro, ahí sí puede derivar', async () => {
    const { texto, registro } = await turno(gemini, [
      { role: 'user', content: 'Hola, quiero la moringa en cápsulas' },
      { role: 'model', content: 'La *Moringa 500 mg x 100* está a S/ 35.00.' },
      { role: 'user', content: '¿Tiene registro sanitario?' },
      {
        role: 'model',
        content:
          'Sí 😊 Todos los productos procesados y de uso directo como cápsulas, aceites y jarabes cuentan con registro sanitario y garantía de originalidad. Si estás en Lima puedes verificar el producto antes de pagar.',
      },
      {
        role: 'user',
        content:
          'Necesito el número exacto del registro sanitario de esa moringa, mándamelo',
      },
    ]);
    console.log('\n[CASO 2] respuesta:\n' + texto);
    console.log('[CASO 2] herramientas:', registro.map((r) => r.nombre));
    // Lo que no puede hacer es inventarse un número.
    expect(texto).not.toMatch(/\bN\.?\s?[A-Z]?\d{6,}\b/);
    const d = registro.find((r) => r.nombre === HERRAMIENTA_DERIVAR);
    if (d) expect(motivoDerivacionValido(d.args.motivo)).not.toBeNull();
  });

  it('CASO 3 — con el producto decidido, ofrece UN complemento antes de cerrar', async () => {
    const { texto, registro } = await turno(gemini, [
      {
        role: 'user',
        content:
          'Hola, tengo el colesterol alto y me dijeron que tome algo natural',
      },
      {
        role: 'model',
        content:
          'Hola, soy Claudio de Hierba Sana 😊 ¿Hace cuánto te detectaron el colesterol alto?',
      },
      { role: 'user', content: 'Como 3 meses. Quiero el omega 3, para Surco' },
    ]);
    console.log('\n[CASO 3] respuesta:\n' + texto);
    console.log('[CASO 3] herramientas:', registro.map((r) => r.nombre));
    // Debe nombrar algo además del omega 3...
    const t = texto.toLowerCase();
    const otros = ['alcachofa', 'psyllium', 'moringa'].filter((p) =>
      t.includes(p),
    );
    expect(otros.length).toBeGreaterThanOrEqual(1);
    // ...y ese algo tiene que existir. La primera versión de la regla hizo
    // que el modelo se sintiera obligado a ofrecer algo y se inventara un
    // "Ajo Sacha" que no estaba en el catálogo: un complemento inventado es
    // peor que no ofrecer nada.
    for (const inventado of ['ajo sacha', 'maca', 'noni', 'uña de gato']) {
      expect(t).not.toContain(inventado);
    }
    // Una propuesta, no una lista.
    expect(otros.length).toBeLessThanOrEqual(1);
  });

  it('CASO 4 — si dice que solo quiere uno, no vuelve a ofrecer', async () => {
    const { texto } = await turno(gemini, [
      { role: 'user', content: 'Quiero el omega 3, para Surco' },
      {
        role: 'model',
        content:
          'El *Omega 3 1000 mg x 100* está a S/ 45.00. Muchos lo acompañan con la *Alcachofa x 100* a S/ 28.00, que ayuda al hígado a procesar las grasas. ¿Te la agrego?',
      },
      { role: 'user', content: 'No, solo el omega 3 nomás' },
    ]);
    console.log('\n[CASO 4] respuesta:\n' + texto);
    expect(texto.toLowerCase()).not.toMatch(/alcachofa|psyllium|moringa/);
  });
});
