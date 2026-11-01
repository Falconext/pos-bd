import { asignarVentas, ventasDeChats, type ChatParaVentas } from './ventas-de-chats';

const d = (s: string) => new Date(s);
const chat = (o: Partial<ChatParaVentas>): ChatParaVentas => ({
  id: 1, creadoEn: d('2026-10-30T15:00:00Z'), actualizadoEn: d('2026-10-30T16:00:00Z'), telefonoProspecto: '51987654321',
  canal: 'WHATSAPP', clienteId: null, comprobanteId: null, dni: null, ...o,
});

describe('asignarVentas', () => {
  it('la venta hecha a mano al prospecto convertido en cliente SÍ cuenta (Krezka, NV01-70)', () => {
    const r = asignarVentas([chat({ clienteId: 500 })], [{ id: 70, clienteId: 500, monto: 149.9, creadoEn: d('2026-10-30T18:00:00Z') }], new Map(), new Map());
    expect(r).toEqual([{ conversacionId: 1, comprobanteId: 70, monto: 149.9, fecha: d('2026-10-30T18:00:00Z') }]);
  });

  it('reconoce por celular y por DNI cuando no se convirtió a cliente', () => {
    const chats = [chat({ id: 1 }), chat({ id: 2, telefonoProspecto: 'ig:123', canal: 'INSTAGRAM', dni: '45678912' })];
    const r = asignarVentas(
      chats,
      [
        { id: 80, clienteId: 7, monto: 50, creadoEn: d('2026-10-31T10:00:00Z') },
        { id: 81, clienteId: 8, monto: 60, creadoEn: d('2026-10-31T11:00:00Z') },
      ],
      new Map([[7, '987654321']]),
      new Map([[8, '45678912']]),
    );
    expect(r.map((v) => [v.comprobanteId, v.conversacionId])).toEqual([[80, 1], [81, 2]]);
  });

  it('no se lleva compras de antes del chat ni de mucho después', () => {
    const r = asignarVentas(
      [chat({ clienteId: 500 })],
      [
        { id: 1, clienteId: 500, monto: 10, creadoEn: d('2026-09-01T10:00:00Z') },
        { id: 2, clienteId: 500, monto: 20, creadoEn: d('2026-12-15T10:00:00Z') },
      ],
      new Map(),
      new Map(),
    );
    expect(r).toEqual([]);
  });

  it('la del pedido del chat cuenta siempre, y una venta nunca dos veces', () => {
    const r = asignarVentas(
      [chat({ id: 1, comprobanteId: 90, clienteId: 500 }), chat({ id: 2, clienteId: 500 })],
      [{ id: 90, clienteId: 500, monto: 99, creadoEn: d('2026-10-30T15:30:00Z') }],
      new Map(),
      new Map(),
    );
    expect(r).toEqual([expect.objectContaining({ conversacionId: 1, comprobanteId: 90 })]);
  });
});

describe('ventasDeChats', () => {
  it('cuenta la boleta en que se convirtió la nota del pedido y deja fuera las anuladas', async () => {
    const prisma: any = {
      leadConversacion: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, creadoEn: d('2026-10-30T15:00:00Z'), actualizadoEn: d('2026-10-30T16:00:00Z'), telefonoProspecto: '51987654321', canal: 'WHATSAPP', prospecto: { clienteId: 500 }, borrador: { comprobanteId: 40, dni: null } },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      cliente: { findMany: jest.fn().mockResolvedValue([]) },
      comprobante: {
        findMany: jest
          .fn()
          // 1) la nota 40 del pedido se pasó a la boleta 41
          .mockResolvedValueOnce([{ id: 40, comprobantesDerivados: [{ id: 41, tipoDoc: '03', serie: 'B001', correlativo: 9 }], consolidadoEn: null }])
          // 2) las ventas
          .mockResolvedValueOnce([
            { id: 41, clienteId: 500, mtoImpVenta: 120, creadoEn: d('2026-10-30T15:40:00Z'), estadoPago: 'COMPLETADO', estadoEnvioSunat: 'EMITIDO' },
            { id: 42, clienteId: 500, mtoImpVenta: 999, creadoEn: d('2026-10-30T17:00:00Z'), estadoPago: 'ANULADO', estadoEnvioSunat: 'EMITIDO' },
          ]),
      },
    };
    const r = await ventasDeChats(prisma, 22, [1]);
    expect(r).toEqual([{ conversacionId: 1, comprobanteId: 41, monto: 120, fecha: d('2026-10-30T15:40:00Z') }]);
  });

  it('sin chats no consulta nada', async () => {
    expect(await ventasDeChats({} as any, 22, [])).toEqual([]);
  });
});
