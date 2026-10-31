import { MetaConversionesService } from './meta-conversiones.service';
import { dniUtil } from './meta-conversiones';

/**
 * 31-10: la nota hecha a mano con el DNI que el cliente dio en el chat, sin
 * celular en la ficha, también se avisa a Meta.
 */
function armar(dniDelChat: string | null, clientes: { id: number; nroDoc: string }[]) {
  const ahora = new Date();
  const clic = new Date(ahora.getTime() - 3600_000);
  const venta = new Date(ahora.getTime() - 600_000);
  const prisma: any = {
    leadAnuncioOrigen: {
      findMany: jest.fn().mockResolvedValue([
        {
          ctwaClid: 'CLID',
          creadoEn: clic,
          conversacion: {
            id: 3,
            numeroWhatsappId: null,
            telefonoProspecto: '51948050978',
            canal: 'WHATSAPP',
            prospecto: { clienteId: null, notificadoEn: null },
            borrador: { comprobanteId: null, dni: dniDelChat },
          },
        },
      ]),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    cliente: { findMany: jest.fn(async ({ where }: any) => clientes.filter((c) => where.nroDoc.in.includes(c.nroDoc))) },
    comprobante: {
      findMany: jest.fn(async ({ where }: any) => {
        const ids = where.OR.find((o: any) => o.clienteId)?.clienteId.in ?? [];
        return ids.includes(50)
          ? [{ id: 70, tipoDoc: 'NV', comprobanteOrigenId: null, clienteId: 50, mtoImpVenta: 149.9, tipoMoneda: 'PEN', creadoEn: venta, estadoPago: 'COMPLETADO', estadoEnvioSunat: null }]
          : [];
      }),
    },
    metaEventoConversion: { createMany: jest.fn(async ({ data }: any) => ({ count: data.length })) },
  };
  const whatsapp: any = { cuentaMetaDelChat: jest.fn().mockResolvedValue({ wabaId: 'W1', token: 'T' }) };
  return { service: new MetaConversionesService(prisma, whatsapp), prisma };
}

describe('venta reconocida por el DNI del chat', () => {
  it('la nota a mano con el DNI que dio en el chat se avisa', async () => {
    const { service, prisma } = armar('71632066', [{ id: 50, nroDoc: '71632066' }]);
    expect(await service.detectar(7)).toBe(1);
    const [fila] = prisma.metaEventoConversion.createMany.mock.calls[0][0].data;
    expect(fila).toMatchObject({ evento: 'Purchase', comprobanteId: 70, conversacionId: 3, ctwaClid: 'CLID', valor: 149.9 });
  });

  it('sin DNI en el chat no se busca por DNI', async () => {
    const { service, prisma } = armar(null, [{ id: 50, nroDoc: '71632066' }]);
    expect(await service.detectar(7)).toBe(0);
    expect(prisma.cliente.findMany).not.toHaveBeenCalled();
  });

  it('otro DNI no se confunde', async () => {
    const { service } = armar('12345678', [{ id: 50, nroDoc: '71632066' }]);
    expect(await service.detectar(7)).toBe(0);
  });
});

describe('dniUtil', () => {
  it('solo DNIs reales de 8 dígitos', () => {
    expect(dniUtil(' 7163-2066 ')).toBe('71632066');
    expect(dniUtil('00000000')).toBeNull();
    expect(dniUtil('20616318773')).toBeNull();
    expect(dniUtil(null)).toBeNull();
  });
});
