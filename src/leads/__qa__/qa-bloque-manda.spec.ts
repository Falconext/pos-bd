/**
 * ¿Gana el bloque generado o el número viejo del texto?
 *
 * Es la prueba que decide si todo esto sirve. El texto de Hierba Sana
 * menciona la tarifa de Lima en CUATRO líneas distintas. Mientras el
 * empresario no las limpie, el prompt lleva las dos versiones: la suya,
 * repetida, y la del bloque generado desde la configuración.
 *
 * Si el modelo se queda con la del texto, el bloque no sirve de nada y hay
 * que migrar el contexto antes de tocar una sola tarifa.
 *
 *   QA_IA=1 npx jest src/leads/__qa__/qa-bloque-manda.spec.ts
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

import { PrismaService } from '../../prisma/prisma.service';
import { GeminiService } from '../../gemini/gemini.service';
import { IaVentasService } from '../leads-ia.service';
import { bloqueComercial } from '../tarifas-y-descuentos';

const correr = process.env.QA_IA === '1' ? describe : describe.skip;
const EMPRESA_ID = Number(process.env.QA_EMPRESA ?? 89);
/** Tarifa inventada, distinta de la que el texto repite cuatro veces. */
const TARIFA_NUEVA = 18;

correr('cuando la configuración y el texto se contradicen', () => {
  jest.setTimeout(180_000);
  let prisma: PrismaService;
  let ia: IaVentasService;
  let contextoLibre = '';
  let bloque = '';

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ia = new IaVentasService(
      new GeminiService({ get: (k: string) => process.env[k] } as never),
    );
    const e = await prisma.empresa.findUnique({
      where: { id: EMPRESA_ID },
      select: { iaVentasContexto: true, iaVentasConfigJson: true },
    });
    contextoLibre = e?.iaVentasContexto ?? '';
    const cfg: any = e?.iaVentasConfigJson ?? {};
    // La configuración, con Lima subida. En la base NO se toca nada.
    bloque = bloqueComercial({
      ...cfg,
      envio: {
        ...cfg.envio,
        zonas: (cfg.envio?.zonas ?? []).map((z: any) =>
          z.nombre === 'Lima' ? { ...z, tarifa: TARIFA_NUEVA } : z,
        ),
      },
    });
  });

  afterAll(() => prisma.$disconnect());

  it('el texto del empresario sigue repitiendo la tarifa vieja', () => {
    // Si esto falla, el contexto ya se migró y esta prueba perdió sentido.
    const veces = (contextoLibre.match(/S\/\s*15/g) ?? []).length;
    expect(veces).toBeGreaterThanOrEqual(3);
    expect(bloque).toContain('S/ 18.00');
  });

  it('el asesor cobra la de la configuración, no la del texto', async () => {
    const { reply } = await ia.generarRespuesta(
      [{ role: 'user', content: '¿Cuánto me cuesta el delivery a Surco?' }],
      [contextoLibre, bloque].join('\n\n'),
      1,
      undefined,
      {
        nombre: 'Hierba Sana',
        rubro: 'productos naturales',
        asesor: 'Claudio',
        contexto: '',
      },
    );
    console.log('\n[tarifa] respuesta:\n' + reply);
    expect(reply).toMatch(/18/);
    expect(reply).not.toMatch(/\b15\b/);
  });
});
