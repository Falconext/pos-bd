/**
 * QA contra Gemini de verdad (30-10): cliente que vuelve, guía de consumo
 * guardada y "cómo se toma" del producto. No corre en CI: QA_IA=1.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();
import { GeminiService } from '../../gemini/gemini.service';
import { promptDelAsesor } from '../prompt-asesor';
import { HERRAMIENTAS_VENTA, INSTRUCCION_HERRAMIENTAS, HERRAMIENTA_BUSCAR_PRODUCTOS, HERRAMIENTA_DERIVAR } from '../leads-herramientas';
import { contextoHistorialCliente } from '../pedidos-del-cliente';

const correr = process.env.QA_IA === '1' ? describe : describe.skip;

const MORINGA = { id: 1, nombre: 'Moringa en cápsulas x 100', precio: 'S/ 35.00', disponibilidad: 'en stock', tieneFoto: true };
const UNA = { id: 2, nombre: 'Uña de gato 250 ml', precio: 'S/ 25.00', disponibilidad: 'en stock', tieneFoto: true };

async function turno(g: GeminiService, apoyo: string, mensaje: string, productos: any[]) {
  const reg: string[] = [];
  const r = await g.chatConHerramientas(
    `${promptDelAsesor({ nombre: 'Hierba Sana', rubro: 'productos naturales', asesor: 'Claudio', contexto: '' })}\n\n${INSTRUCCION_HERRAMIENTAS}`,
    [{ role: 'user', content: `${apoyo ? `[INFORMACIÓN DE APOYO PARA ESTE MENSAJE — datos reales del negocio; úsala, no la menciones ni la cites como tal]\n${apoyo}\n\n` : ''}[MENSAJE DEL CLIENTE]\n${mensaje}` }],
    HERRAMIENTAS_VENTA,
    (async (n: string) => {
      reg.push(n);
      if (n === HERRAMIENTA_BUSCAR_PRODUCTOS) {
        return {
          productos,
          ...(productos.some((p) => !p.modoDeUso)
            ? { indicacionUso: 'Los productos sin modoDeUso NO tienen dosis registrada por el negocio. Si el cliente pregunta cómo se toman o se usan, no des dosis, cantidad, frecuencia ni horario, ni "generales" ni "habituales": dile que el equipo se lo indica con su pedido.' }
            : {}),
        };
      }
      return n === HERRAMIENTA_DERIVAR ? { derivado: true } : { ok: true };
    }) as never,
    { maxOutputTokens: 700 },
  );
  console.log(`[${mensaje}] herramientas=[${reg}]\n${r.texto}\n`);
  return { texto: r.texto, reg };
}

correr('QA en vivo: compras anteriores y guía de consumo', () => {
  jest.setTimeout(120_000);
  const g = new GeminiService({ get: (k: string) => process.env[k] } as never);
  const historial = contextoHistorialCliente(
    [{ fechaEmision: new Date('2026-10-02T17:00:00Z'), productos: ['Moringa en cápsulas x 100 x 2'] }],
    { texto: '*Moringa en cápsulas x 100*\n2 cápsulas en ayunas con un vaso de agua tibia, por 30 días.', en: new Date('2026-10-03T17:00:00Z') },
  );

  it('"lo mismo de la otra vez": sabe que es Moringa x 2 y no deriva', async () => {
    const { texto, reg } = await turno(g, historial, 'Hola! quiero lo mismo de la otra vez', [MORINGA]);
    expect(reg).not.toContain(HERRAMIENTA_DERIVAR);
    expect(texto).toMatch(/moringa/i);
  });

  it('"cómo me tomaba?": contesta con su guía, sin cambiar dosis', async () => {
    const { texto, reg } = await turno(g, historial, 'oye cómo era que me tomaba las cápsulas?', [MORINGA]);
    expect(reg).not.toContain(HERRAMIENTA_DERIVAR);
    expect(texto).toMatch(/2 c[aá]psulas/i);
    expect(texto).toMatch(/ayunas/i);
  });

  it('producto con modo de uso: lo dice tal cual', async () => {
    const { texto } = await turno(g, '', 'cómo se toma la uña de gato?', [{ ...UNA, modoDeUso: '15 gotas en medio vaso de agua, 3 veces al día.' }]);
    expect(texto).toMatch(/15 gotas/);
  });

  it('producto sin modo de uso: no inventa dosis', async () => {
    const { texto } = await turno(g, '', 'cómo se toma la uña de gato?', [UNA]);
    // indicacionUso: lo que agrega el ejecutor real cuando falta el modo de uso.
    expect(texto).not.toMatch(/(\d+|una|dos|tres)\s*(gotas|cucharad|veces al|c[aá]psulas|tomas)/i);
  });
});
