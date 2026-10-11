/**
 * El aviso de lo que pidieron y no se pudo vender.
 *
 * El dueño lo decidió así, por audio: *"mejor lo marco yo manual, que el
 * asistente me informe a mí"*. La alternativa era que la IA marcara el
 * producto sola, y el riesgo de eso es que una conversación mal entendida
 * saque un producto del catálogo para TODOS los clientes, y el negocio se
 * entere recién cuando ese producto deja de venderse.
 */
import { LeadsConsultasService } from './leads-consultas.service';

function armar(consultas: Record<string, unknown>[]) {
  const avisos: Record<string, unknown>[] = [];
  const marcadas: Record<string, unknown>[] = [];
  const prisma = {
    empresa: { findMany: jest.fn().mockResolvedValue([{ id: 89 }]) },
    leadConsulta: {
      findMany: jest.fn().mockResolvedValue(consultas),
      updateMany: jest.fn((a: any) => {
        marcadas.push(a);
        return Promise.resolve({ count: consultas.length });
      }),
    },
  } as never;
  const notificaciones = {
    notificarAdminsEmpresa: jest.fn((a: any) => {
      avisos.push(a);
      return Promise.resolve({});
    }),
  } as never;
  return {
    servicio: new LeadsConsultasService(prisma, notificaciones),
    avisos,
    marcadas,
    prisma,
  };
}

const c = (id: number, texto: string, over: Record<string, unknown> = {}) => ({
  id,
  texto,
  productoId: null,
  disponibilidad: null,
  ...over,
});

describe('a quién se le avisa y de qué', () => {
  it('agrupa por producto: tres personas pidiendo lo mismo es una señal', async () => {
    const a = armar([
      c(1, 'naturplus 3000'),
      c(2, 'naturplus 3000'),
      c(3, 'naturplus 3000'),
      c(4, 'omega 7'),
    ]);
    await a.servicio.avisarLoQuePidieronYNoHabia();

    const msg = String(a.avisos[0].mensaje);
    expect(msg).toContain('naturplus 3000 — 3 veces');
    expect(msg).toContain('omega 7 — 1 vez');
    expect(a.avisos[0].titulo).toContain('4 productos');
  });

  it('distingue lo que está en el catálogo de lo que no', async () => {
    // Son dos acciones distintas: una es corregir una marca, la otra es
    // decidir si vale la pena traer un producto nuevo.
    const a = armar([
      c(1, 'moringa', { productoId: 12, disponibilidad: 'NO_DISPONIBLE' }),
      c(2, 'producto que no vendemos'),
    ]);
    await a.servicio.avisarLoQuePidieronYNoHabia();

    const msg = String(a.avisos[0].mensaje);
    expect(msg).toMatch(/moringa.*está en el catálogo, marcado como no disponible/);
    expect(msg).toMatch(/producto que no vendemos.*no está en el catálogo/);
    expect(msg).toMatch(/1 de estos no están en tu catálogo/);
  });

  it('dice dónde verlo y qué hacer, no solo que pasó', async () => {
    const a = armar([c(1, 'algo')]);
    await a.servicio.avisarLoQuePidieronYNoHabia();
    expect(String(a.avisos[0].mensaje)).toMatch(
      /IA de Ventas → Analítica.*marca la disponibilidad/s,
    );
  });
});

describe('no repetirse', () => {
  it('marca como avisadas las consultas que entraron en el aviso', async () => {
    // Sin esto, el mismo producto reaparecería todos los días hasta que
    // alguien lo atienda, y un aviso que se repite se ignora.
    const a = armar([c(1, 'x'), c(2, 'y')]);
    await a.servicio.avisarLoQuePidieronYNoHabia();
    const marca = a.marcadas[0] as { where: unknown; data: { avisadoEn: Date } };
    expect(marca.where).toEqual({ id: { in: [1, 2] } });
    expect(marca.data.avisadoEn).toBeInstanceOf(Date);
  });

  it('solo mira las que nunca se avisaron', async () => {
    const a = armar([c(1, 'x')]);
    await a.servicio.avisarLoQuePidieronYNoHabia();
    const filtro = (a.prisma as any).leadConsulta.findMany.mock.calls[0][0].where;
    expect(filtro.avisadoEn).toBeNull();
  });

  it('sin nada pendiente no molesta a nadie', async () => {
    const a = armar([]);
    await a.servicio.avisarLoQuePidieronYNoHabia();
    expect(a.avisos).toHaveLength(0);
  });
});

describe('el asistente NO toca el catálogo', () => {
  it('el aviso no actualiza ningún producto', async () => {
    // Es el punto de la decisión: informar, no marcar.
    const a = armar([c(1, 'moringa', { productoId: 12 })]);
    await a.servicio.avisarLoQuePidieronYNoHabia();
    expect((a.prisma as any).producto).toBeUndefined();
  });
});
