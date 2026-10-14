/**
 * El embudo no puede llenarse con las pruebas del propio negocio.
 *
 * El dueño y su equipo escriben al WhatsApp de su empresa haciéndose pasar
 * por clientes para ver cómo responde la IA — es la única forma de probarla.
 * Cada una de esas pruebas quedaba registrada como un lead: en el tablero de
 * Hierba Sana, dos de las tres conversaciones eran suyas, una desde el número
 * de su propio supervisor, con puntajes de 82 y 96. El empresario lo dijo
 * así: "Estilo colecta no debe figurar en el flujo".
 *
 * Un embudo con leads falsos no es un detalle estético: es la pantalla en la
 * que el negocio decide a quién llamar primero.
 *
 * La regla que se defiende: a un número interno se le RESPONDE igual —si no,
 * no se podría probar— pero no se le crea prospecto ni se le califica.
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { LeadsMessageProcessor } from './leads-message.processor';

const ADMIN = '955947892';
const CONFIGURADO = '51919755320'; // "StiloColecta": su número de pruebas
const CLIENTE = '51991065217'; // Diego Ortega, cliente de verdad

function armar() {
  const prospectosCreados: Record<string, unknown>[] = [];
  const prisma = {
    usuario: {
      findMany: jest.fn().mockResolvedValue([{ celular: ADMIN }]),
    },
    leadProspecto: {
      upsert: jest.fn((args: any) => {
        prospectosCreados.push(args.create);
        return Promise.resolve({ id: 1, notificadoEn: null });
      }),
    },
  } as never;
  const pedido = {
    configDe: jest.fn().mockResolvedValue({
      numerosInternos: [CONFIGURADO],
    }),
  } as never;

  const processor = new LeadsMessageProcessor(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    pedido,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { processor: processor as any, prisma: prisma as any, prospectosCreados };
}

describe('quién cuenta como "el propio negocio"', () => {
  it('el celular de un administrador, aunque WhatsApp lo mande con el 51', async () => {
    const { processor } = armar();
    await expect(processor.esDeLaEmpresa(89, '51955947892')).resolves.toBe(true);
  });

  it('un número de pruebas configurado a mano', async () => {
    const { processor } = armar();
    await expect(processor.esDeLaEmpresa(89, CONFIGURADO)).resolves.toBe(true);
  });

  it('un cliente de verdad NO', async () => {
    const { processor } = armar();
    await expect(processor.esDeLaEmpresa(89, CLIENTE)).resolves.toBe(false);
  });

  it('si la consulta falla, se asume que es un cliente', async () => {
    // Perder un lead real es mucho peor que dejar entrar una prueba: ante la
    // duda, el embudo se ensucia pero no se vacía.
    const { processor, prisma } = armar();
    prisma.usuario.findMany.mockRejectedValue(new Error('sin conexión'));
    await expect(processor.esDeLaEmpresa(89, CLIENTE)).resolves.toBe(false);
  });
});

describe('la calificación BANT', () => {
  const cal = {
    score: { total: 96, budget: 25, authority: 25, need: 25, timeline: 21 },
    status: 'CALIENTE',
    resumen: 'Prueba interna',
    puntosClave: [],
    proximaAccion: null,
    debeTransferir: true,
  } as never;
  const empresa = { id: 89, nombreComercial: 'Hierba Sana', razonSocial: 'X' };

  it('no califica ni crea prospecto para el propio negocio', async () => {
    // Sin esta guarda, el upsert de la calificación volvía a crear el
    // prospecto que la entrada no había creado: la limpieza del embudo
    // duraba hasta el cuarto mensaje.
    const { processor, prospectosCreados } = armar();
    await processor.aplicarCalificacion(
      empresa,
      81,
      { telefono: '51955947892', nombre: 'Casa Naturista Hierba Sana' },
      cal,
      [],
    );
    expect(prospectosCreados).toHaveLength(0);
  });

  it('tampoco le manda al dueño una alerta de lead caliente sobre sí mismo', async () => {
    const { processor, prisma } = armar();
    await processor.aplicarCalificacion(
      empresa,
      81,
      { telefono: '51955947892', nombre: 'Casa Naturista Hierba Sana' },
      cal,
      [],
    );
    expect(prisma.leadProspecto.upsert).not.toHaveBeenCalled();
  });

  it('a un cliente de verdad sí lo califica', async () => {
    const { processor, prospectosCreados } = armar();
    await processor
      .aplicarCalificacion(empresa, 52, { telefono: CLIENTE, nombre: 'Diego' }, cal, [])
      .catch(() => undefined); // lo de después (alertas) no es lo que se prueba
    expect(prospectosCreados).toHaveLength(1);
    expect(prospectosCreados[0]).toMatchObject({
      telefonoProspecto: CLIENTE,
      puntaje: 96,
    });
  });
});
