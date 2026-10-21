/**
 * El aviso de "Productos Agotados" de ZABDI MULTIMARCAS (2026-10-21): salía
 * todos los días, dos veces, con variantes que nunca tuvieron stock.
 */
import { claveAviso, clavesAvisadas, porAvisar } from './aviso-inventario';
import { InventarioNotificacionesService } from './inventario-notificaciones.service';

describe('claves del aviso', () => {
  it('distingue el producto por sede y el global', () => {
    expect(claveAviso({ id: 5, sedeId: 116 })).toBe('5-116');
    expect(claveAviso({ id: 5, sedeId: null })).toBe('5-g');
  });

  it('junta las claves de varias notificaciones e ignora las viejas sin metaData', () => {
    const claves = clavesAvisadas([{ claves: ['1-116'] }, null, { otra: 1 }, { claves: ['2-116', 3] }]);
    expect([...claves]).toEqual(['1-116', '2-116']);
  });

  it('solo queda lo que no se avisó', () => {
    const r = porAvisar([{ id: 1, sedeId: 116 }, { id: 2, sedeId: 116 }], new Set(['1-116']));
    expect(r).toEqual([{ id: 2, sedeId: 116 }]);
  });
});

describe('la revisión de las 8 a. m.', () => {
  const SEDE = { nombre: 'Sede Principal' };
  const fila = (productoId: number, descripcion: string) => ({
    productoId,
    sedeId: 116,
    stock: 0,
    stockMinimo: 0,
    sede: SEDE,
    producto: { codigo: `P${productoId}`, descripcion, stockMinimo: 0 },
  });

  function armar(opts: { movidos: number[]; avisadas?: string[] }) {
    const prisma: any = {
      producto: { findMany: jest.fn().mockResolvedValue([]) },
      productoStock: {
        findMany: jest
          .fn()
          // paso 3: en cero por sede; paso 4: stock bajo por sede
          .mockResolvedValueOnce([
            fila(1, 'crema expression clásico'),
            fila(2, 'crema expression spirit'),
            fila(3, 'colonia agu hierbas'),
          ])
          .mockResolvedValueOnce([]),
      },
      sede: { count: jest.fn().mockResolvedValue(1) },
      movimientoKardex: {
        findMany: jest.fn().mockResolvedValue(opts.movidos.map((productoId) => ({ productoId, sedeId: 116 }))),
      },
      usuario: {
        findMany: jest.fn().mockResolvedValue([{ id: 150, rol: 'ADMIN_EMPRESA', sedeId: 116, sedesAsignadas: [] }]),
      },
      notificacion: {
        findMany: jest.fn().mockResolvedValue(opts.avisadas ? [{ metaData: { claves: opts.avisadas } }] : []),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data })),
      },
    };
    const notificaciones: any = { emitirNotificacionEnTiempoReal: jest.fn() };
    return { servicio: new InventarioNotificacionesService(prisma, notificaciones), prisma };
  }

  it('no avisa como agotado lo que nunca tuvo stock', async () => {
    const { servicio, prisma } = armar({ movidos: [1] });
    const r = await servicio.verificarInventarioEmpresa(87);

    expect(r.productosAgotados).toBe(1);
    expect(prisma.notificacion.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.notificacion.create.mock.calls[0][0];
    expect(data.mensaje).toContain('crema expression clásico');
    expect(data.mensaje).not.toContain('spirit');
    expect(data.metaData).toEqual({ claves: ['1-116'] });
  });

  it('un solo aviso con una sola sede: el general ya no incluye productos con stock por sede', async () => {
    const { servicio, prisma } = armar({ movidos: [1] });
    await servicio.verificarInventarioEmpresa(87);
    const [agotadosGlobal, bajoGlobal] = prisma.producto.findMany.mock.calls.map((c: any) => c[0].where);
    expect(agotadosGlobal.stocks).toEqual({ none: {} });
    expect(bajoGlobal.stocks).toEqual({ none: {} });
    expect(prisma.notificacion.create.mock.calls[0][0].data.titulo).toBe('⚠️ Sede Principal · Productos Agotados');
  });

  it('al día siguiente no repite la misma lista', async () => {
    const { servicio, prisma } = armar({ movidos: [1, 3], avisadas: ['1-116', '3-116'] });
    await servicio.verificarInventarioEmpresa(87);
    expect(prisma.notificacion.create).not.toHaveBeenCalled();
  });

  it('si se agota uno nuevo, avisa solo ese', async () => {
    const { servicio, prisma } = armar({ movidos: [1, 3], avisadas: ['1-116'] });
    await servicio.verificarInventarioEmpresa(87);
    const { data } = prisma.notificacion.create.mock.calls[0][0];
    expect(data.mensaje).toBe('El producto "colonia agu hierbas [Sede: Sede Principal]" (P3) está AGOTADO en la sede Sede Principal.');
  });

  it('mira solo los avisos de los últimos 7 días, del mismo usuario y título', async () => {
    const { servicio, prisma } = armar({ movidos: [1], avisadas: ['1-116'] });
    const antes = Date.now();
    await servicio.verificarInventarioEmpresa(87);
    const where = prisma.notificacion.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ usuarioId: 150, empresaId: 87, titulo: '⚠️ Sede Principal · Productos Agotados' });
    expect(antes - where.creadoEn.gte.getTime()).toBeGreaterThanOrEqual(7 * 24 * 3600_000 - 1000);
  });
});
