/**
 * B4 — la cascada de búsqueda usa el escalón más barato que resuelve.
 *
 * Importa el orden, no solo el resultado: los dos primeros escalones son SQL
 * (milisegundos) y el tercero cuesta un embedding. Si el tercero se dispara
 * cuando no hace falta, cada mensaje paga de más y tarda más.
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { LeadsMessageProcessor } from './leads-message.processor';
import { HERRAMIENTA_BUSCAR_PRODUCTOS } from './leads-herramientas';

const EMPRESA = 89;

const producto = (id: number, descripcion: string) => ({
  id,
  codigo: `PROD-${id}`,
  descripcion,
  precioUnitario: 31,
  stock: 50,
  moneda: 'PEN',
  imagenUrl: null,
  disponibilidad: null,
  prioridadVenta: null,
});

function armar(opts: {
  porPalabras?: any[];
  porParecido?: any[];
  fragmentos?: string[];
  porCodigo?: any[];
}) {
  const prisma: any = {
    producto: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            where?.codigo?.in
              ? (opts.porCodigo ?? [])
              : (opts.porPalabras ?? []),
          ),
        ),
    },
    $queryRaw: jest.fn().mockResolvedValue(opts.porParecido ?? []),
  };
  const rag = {
    buscarFragmentos: jest.fn().mockResolvedValue(opts.fragmentos ?? []),
  };
  const processor = new LeadsMessageProcessor(
    prisma,
    {} as any,
    rag as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const ejecutor = (processor as any).crearEjecutor(
    EMPRESA,
    '51999999999',
    new Set(),
  );
  return { ejecutor, prisma, rag };
}

const buscar = (ejecutor: any, consulta: string) =>
  ejecutor(HERRAMIENTA_BUSCAR_PRODUCTOS, { consulta }) as Promise<any>;

describe('la cascada para en el escalón que resuelve', () => {
  it('si las palabras encuentran, no gasta trigramas ni embedding', async () => {
    const { ejecutor, prisma, rag } = armar({
      porPalabras: [producto(1, 'Moringa 100 cápsulas')],
    });

    const r = await buscar(ejecutor, 'moringa');

    expect(r.productos).toHaveLength(1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(rag.buscarFragmentos).not.toHaveBeenCalled();
  });

  it('si no hay palabras, prueba el parecido antes de gastar un embedding', async () => {
    // El caso "fenocreco" → "Fenogreco".
    const { ejecutor, prisma, rag } = armar({
      porPalabras: [],
      porParecido: [producto(2, 'Fenogreco Alholva - NATURAL MEDIX')],
    });

    const r = await buscar(ejecutor, 'fenocreco');

    expect(r.productos[0].nombre).toContain('Fenogreco');
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(rag.buscarFragmentos).not.toHaveBeenCalled();
  });

  it('solo llega a las fichas cuando los dos escalones de SQL fallan', async () => {
    // El caso "dolor de rodillas": no se parece al nombre de ningún producto.
    const { ejecutor, rag } = armar({
      porPalabras: [],
      porParecido: [],
      fragmentos: ['Artrisan — S/ 31 (cód. PROD-3)'],
      porCodigo: [producto(3, 'Artrisan - NATURAL MEDIX')],
    });

    const r = await buscar(ejecutor, 'dolor de rodillas');

    expect(rag.buscarFragmentos).toHaveBeenCalled();
    expect(r.productos[0].nombre).toContain('Artrisan');
  });

  it('avisa al modelo de que lo hallado por fichas NO es lo que pidió', async () => {
    // Sin esta nota, el modelo podría ofrecer la alternativa como si fuera el
    // producto que el cliente nombró.
    const { ejecutor } = armar({
      porPalabras: [],
      porParecido: [],
      fragmentos: ['Algo — S/ 31 (cód. PROD-3)'],
      porCodigo: [producto(3, 'Otra cosa')],
    });

    const r = await buscar(ejecutor, 'NaturPlus Max');

    expect(r.nota).toMatch(/NO son el producto exacto/);
  });

  it('una búsqueda que sí acierta no lleva esa nota', async () => {
    const { ejecutor } = armar({
      porPalabras: [producto(1, 'Moringa 100 cápsulas')],
    });

    const r = await buscar(ejecutor, 'moringa');

    expect(r.nota).toBeUndefined();
  });

  it('sin resultados en ningún escalón, le dice al modelo que reintente', async () => {
    const { ejecutor } = armar({
      porPalabras: [],
      porParecido: [],
      fragmentos: [],
    });

    const r = await buscar(ejecutor, 'xyzqwerty');

    expect(r.productos).toEqual([]);
    expect(r.mensaje).toMatch(/otro enfoque|Sin coincidencias/);
  });

  it('respeta el orden de relevancia del RAG al resolver los códigos', async () => {
    // La base devuelve en su propio orden; el que vale es el del RAG.
    const { ejecutor } = armar({
      porPalabras: [],
      porParecido: [],
      fragmentos: ['A — (cód. PROD-9)\n\nB — (cód. PROD-4)'],
      porCodigo: [producto(4, 'Segundo'), producto(9, 'Primero')],
    });

    const r = await buscar(ejecutor, 'dolencia');

    expect(r.productos.map((p: any) => p.nombre)).toEqual([
      'Primero',
      'Segundo',
    ]);
  });
});
