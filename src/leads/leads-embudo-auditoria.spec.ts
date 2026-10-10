/**
 * El token NO lleva el nombre del usuario.
 *
 * La estrategia JWT selecciona rol, permisos y banderas, pero no `nombre`, así
 * que `user.nombre` es `undefined` en todos los controladores. Cuando eso caía
 * en el campo de auditoría del embudo, cada clic del encargado quedaba
 * registrado como movimiento "del bot" — y entonces la pregunta que el candado
 * de pago existe para responder ("¿quién dio el OK a este pago?") no se podía
 * responder.
 *
 * Lo encontró el QA por HTTP, no el test unitario: el unitario le pasaba el
 * nombre a mano, que es algo que en producción no pasa nunca.
 */
import { LeadsEmbudoService } from './leads-embudo.service';
import { EtapaCrm } from './leads-embudo';

function prismaFalso(nombreEnBd: string | null = 'ROSA QUISPE') {
  const historial: Record<string, unknown>[] = [];
  return {
    historial,
    leadProspecto: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 1, etapa: 'DATOS_COMPLETOS', conversacionId: 9 }),
      update: jest.fn().mockResolvedValue({ id: 1, etapa: 'POR_DESPACHAR', etapaEn: new Date() }),
    },
    leadEtapaHistorial: {
      create: jest.fn((args: any) => {
        historial.push(args.data);
        return args.data;
      }),
    },
    leadComprobantePago: { count: jest.fn().mockResolvedValue(0) },
    usuario: {
      findUnique: jest.fn().mockResolvedValue(
        nombreEnBd ? { nombre: nombreEnBd } : null,
      ),
    },
    // El servicio mueve prospecto e historial en una transacción.
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  } as any;
}

const s3 = { isEnabled: () => false } as any;

describe('quién movió el pedido', () => {
  it('con solo el id del usuario, busca su nombre en la base', async () => {
    const prisma = prismaFalso('ROSA QUISPE');
    const srv = new LeadsEmbudoService(prisma, s3);

    await srv.mover(1, 89, EtapaCrm.POR_DESPACHAR, { usuario: { id: 29 } });

    expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
      where: { id: 29 },
      select: { nombre: true },
    });
    expect(prisma.historial[0].actor).toBe('ROSA QUISPE');
  });

  it('nunca escribe "bot" cuando lo movió una persona', async () => {
    // Aunque no se pueda leer el nombre: mejor "usuario #29" que una
    // auditoría que le atribuye al bot una decisión humana.
    const prisma = prismaFalso(null);
    const srv = new LeadsEmbudoService(prisma, s3);

    await srv.mover(1, 89, EtapaCrm.POR_DESPACHAR, { usuario: { id: 29 } });

    expect(prisma.historial[0].actor).not.toBe('bot');
    expect(prisma.historial[0].actor).toBe('usuario #29');
    expect(prisma.historial[0].usuarioId).toBe(29);
  });

  it('un movimiento automático sí queda como "bot"', async () => {
    const prisma = prismaFalso();
    const srv = new LeadsEmbudoService(prisma, s3);

    await srv.mover(1, 89, EtapaCrm.COTIZADO, { nota: 'cotizó el chat' });

    expect(prisma.historial[0].actor).toBe('bot');
    expect(prisma.historial[0].usuarioId).toBeNull();
    // Y sin usuario no se consulta la tabla: sería una lectura al aire.
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
  });

  it('el nombre que ya viene en el llamado se respeta y no se vuelve a leer', async () => {
    const prisma = prismaFalso();
    const srv = new LeadsEmbudoService(prisma, s3);

    await srv.mover(1, 89, EtapaCrm.POR_DESPACHAR, {
      usuario: { id: 29, nombre: 'LA ENCARGADA' },
    });

    expect(prisma.historial[0].actor).toBe('LA ENCARGADA');
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
  });
});
