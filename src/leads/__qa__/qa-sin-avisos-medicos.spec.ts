/**
 * QA contra Gemini de verdad: negocio con `sinAvisosMedicos` (Hierba Sana
 * 30-10). Ni el prompt ni el filtro deben dejar pasar "consulta a tu médico".
 * No corre en CI: QA_IA=1 y GEMINI_API_KEY.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();
import { GeminiService } from '../../gemini/gemini.service';
import { promptDelAsesor } from '../prompt-asesor';
import { HERRAMIENTAS_VENTA, INSTRUCCION_HERRAMIENTAS, HERRAMIENTA_BUSCAR_PRODUCTOS } from '../leads-herramientas';
import { PROHIBIDO_AVISOS_MEDICOS, sinMencionesMedicas } from '../alto-riesgo';

const correr = process.env.QA_IA === '1' ? describe : describe.skip;
const MEDICO = /m[eé]dic|doctor|especialista|reemplaza|tratamiento/i;

correr('QA en vivo: sin avisos médicos', () => {
  jest.setTimeout(120_000);
  const g = new GeminiService({ get: (k: string) => process.env[k] } as never);
  const casos = [
    'Hola, soy diabético y tomo metformina, qué me recomiendas para bajar el azúcar?',
    'Tengo gastritis hace meses, qué producto me sirve?',
    'Estoy embarazada, puedo tomar moringa?',
  ];
  for (const mensaje of casos) {
    it(mensaje, async () => {
      const r = await g.chatConHerramientas(
        `${promptDelAsesor({ nombre: 'Hierba Sana', rubro: 'productos naturales', asesor: 'Claudio', contexto: PROHIBIDO_AVISOS_MEDICOS })}\n\n${INSTRUCCION_HERRAMIENTAS}`,
        [{ role: 'user', content: mensaje }],
        HERRAMIENTAS_VENTA,
        (async (n: string) =>
          n === HERRAMIENTA_BUSCAR_PRODUCTOS
            ? { productos: [{ id: 1, nombre: 'Moringa en cápsulas x 100', precio: 35, stock: 40 }, { id: 2, nombre: 'Uña de gato 250 ml', precio: 25, stock: 12 }] }
            : { ok: true }) as never,
        { maxOutputTokens: 600 },
      );
      const final = sinMencionesMedicas(r.texto);
      console.log(`[${mensaje}]\nMODELO: ${r.texto}\nFINAL: ${final}\nmodelo mencionó médico: ${MEDICO.test(r.texto)}`);
      expect(final).not.toMatch(MEDICO);
      expect(final.length).toBeGreaterThan(20);
    });
  }
});
