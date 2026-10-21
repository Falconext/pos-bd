/**
 * Cliente que vuelve o que pide un segundo pedido en la misma conversación
 * (QA 21-10): el segundo no puede editar la nota del primero ni heredar sus
 * pagos.
 */
import { LeadsPedidoService } from './leads-pedido.service';

function armar(borrador: Record<string, unknown>, vouchers: Array<{ montoLeido: number; recibidoEn: Date }>) {
  const prisma: any = {
    leadPedidoBorrador: {
      findUnique: jest.fn(() => Promise.resolve(borrador)),
      update: jest.fn(({ data }: any) => {
        Object.assign(borrador, data);
        return Promise.resolve(borrador);
      }),
    },
    leadProspecto: { findFirst: jest.fn(() => Promise.resolve(null)) },
    leadComprobantePago: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          vouchers
            .filter((v) => !where.recibidoEn || v.recibidoEn >= where.recibidoEn.gte)
            .map((v) => ({ montoLeido: v.montoLeido, medioLeido: 'Yape' })),
        ),
      ),
    },
  };
  const svc = Object.create(LeadsPedidoService.prototype) as any;
  svc.prisma = prisma;
  svc.logger = { log: jest.fn(), warn: jest.fn() };
  return { svc, prisma, borrador };
}

describe('pedido aparte y pagos por pedido', () => {
  it('con un pedido registrado abierto, "pedido aparte" empieza uno nuevo sin destino', async () => {
    const { svc, borrador } = armar(
      { comprobanteId: 2, tipoZona: 'LIMA', lugar: 'Surco', costoEnvio: 15, direccion: 'Av. Primavera 1050', nombre: 'Diego' },
      [],
    );
    expect(await svc.separarPedidoSiCorresponde(89, 42, true)).toBe(true);
    expect(borrador.comprobanteId).toBeNull();
    expect(borrador.tipoZona).toBeNull();
    expect(borrador.costoEnvio).toBeNull();
    expect(borrador.direccion).toBeNull();
    // Quien compra sigue siendo el mismo cliente.
    expect(borrador.nombre).toBe('Diego');
    expect(borrador.pedidoDesde).toBeInstanceOf(Date);
  });

  it('sin el flag, o sin pedido registrado, no toca nada', async () => {
    const a = armar({ comprobanteId: 2 }, []);
    expect(await a.svc.separarPedidoSiCorresponde(89, 42, undefined)).toBe(false);
    expect(a.borrador.comprobanteId).toBe(2);
    const b = armar({ comprobanteId: null }, []);
    expect(await b.svc.separarPedidoSiCorresponde(89, 42, true)).toBe(false);
  });

  it('el pedido nuevo no cuenta los vouchers del anterior', async () => {
    const ayer = new Date('2026-10-20T22:00:00Z');
    const hoy = new Date('2026-10-21T15:00:00Z');
    const { svc } = armar({ comprobanteId: null, pedidoDesde: new Date('2026-10-21T14:00:00Z') }, [
      { montoLeido: 12, recibidoEn: ayer },
      { montoLeido: 20, recibidoEn: hoy },
    ]);
    expect((await svc.pagadoPorElCliente(42, 1000)).monto).toBe(20);
    expect(await svc.hayVoucherLeido(42)).toBe(true);
  });

  it('el primer pedido (sin corte) cuenta todo, como antes', async () => {
    const { svc } = armar({ comprobanteId: null, pedidoDesde: null }, [
      { montoLeido: 12, recibidoEn: new Date() },
    ]);
    expect((await svc.pagadoPorElCliente(42, 1000)).monto).toBe(12);
  });
});
