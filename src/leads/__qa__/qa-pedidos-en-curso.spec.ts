/**
 * QA contra Gemini de verdad: "¿dónde está mi pedido?" con los PEDIDOS EN
 * CURSO que van en el contexto del turno. Contesta con eso; deriva si no hay.
 * No corre en CI: QA_IA=1 y GEMINI_API_KEY.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();
import { GeminiService } from '../../gemini/gemini.service';
import { promptDelAsesor } from '../prompt-asesor';
import { HERRAMIENTAS_VENTA, INSTRUCCION_HERRAMIENTAS, HERRAMIENTA_DERIVAR } from '../leads-herramientas';
import { contextoPedidosDelCliente } from '../pedidos-del-cliente';

const correr = process.env.QA_IA === '1' ? describe : describe.skip;

async function turno(g: GeminiService, apoyo: string, mensaje: string) {
  const reg: string[] = [];
  const r = await g.chatConHerramientas(
    `${promptDelAsesor({ nombre: 'Hierba Sana', rubro: 'productos naturales', asesor: 'Claudio', contexto: '' })}\n\n${INSTRUCCION_HERRAMIENTAS}`,
    [{ role: 'user', content: `${apoyo ? `[INFORMACIÓN DE APOYO PARA ESTE MENSAJE — datos reales del negocio; úsala, no la menciones ni la cites como tal]\n${apoyo}\n\n` : ''}[MENSAJE DEL CLIENTE]\n${mensaje}` }],
    HERRAMIENTAS_VENTA,
    (async (n: string) => { reg.push(n); return n === HERRAMIENTA_DERIVAR ? { derivado: true } : { ok: true }; }) as never,
    { maxOutputTokens: 600 },
  );
  console.log(`[${mensaje}] herramientas=[${reg}]\n${r.texto}`);
  return { texto: r.texto, reg };
}

correr('QA en vivo: pedidos en curso', () => {
  jest.setTimeout(120_000);
  const g = new GeminiService({ get: (k: string) => process.env[k] } as never);

  it('contesta con la agencia, el N° de orden, la clave y el saldo', async () => {
    const bloque = contextoPedidosDelCliente([{
      serie: 'NV01', correlativo: 214, fechaEmision: new Date(), total: 110, saldo: 40, productos: ['Moringa x 2'],
      despacho: { estado: 'EN_CAMINO', transportista: 'SHALOM_PRO', agenciaDestino: 'Shalom Arequipa Av. Parra', etapaCourier: 'destino', nroOrden: '45821903', claveRecojo: '7310' },
    }]);
    const { texto, reg } = await turno(g, bloque, 'Hola, dónde está mi pedido? ya llegó?');
    expect(reg).not.toContain(HERRAMIENTA_DERIVAR);
    expect(texto).toMatch(/Arequipa/);
    expect(texto).toMatch(/7310/);
  });

  it('sin pedidos en curso, deriva', async () => {
    const { reg } = await turno(g, '', 'Hola, hice un pedido la semana pasada, dónde está?');
    expect(reg).toContain(HERRAMIENTA_DERIVAR);
  });
});
