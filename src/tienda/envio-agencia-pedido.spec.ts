/**
 * El pedido de la tienda con envío por agencia, y su vínculo con el
 * comprobante que se emite al convertirlo (29-10).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TiendaService } from './tienda.service';

const PRODUCTO = { id: 7, descripcion: 'Polo', precioUnitario: 50, stock: 20, atributosTecnicos: {} };

function armar(extra: { pedido?: any; comprobante?: any } = {}) {
  const creado: any = {};
  const actualizado: any = {};
  const prisma: any = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue({
        id: 85,
        costoEnvioFijo: 0,
        envioGratisDesdeSoles: 0,
        minimoCompra: 0,
        aceptaRecojo: true,
        aceptaEnvio: true,
        tiendaVentaSinStock: false,
        nombreComercial: 'Mi Tienda',
        razonSocial: 'MI TIENDA S.A.C.',
        mpConectado: false,
        couriersTienda: ['SHALOM', 'OLVA'],
        plan: { tieneTienda: true },
      }),
    },
    producto: {
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.productoPadreId !== undefined ? null : PRODUCTO),
      ),
    },
    productoCodigoBarras: { findFirst: jest.fn().mockResolvedValue(null) },
    historialEstadoPedido: { create: jest.fn().mockResolvedValue({}) },
    comprobante: { findFirst: jest.fn().mockResolvedValue('comprobante' in extra ? extra.comprobante : { id: 900, serie: 'NV01', correlativo: 12 }) },
    pedidoTienda: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(creado, data);
        return Promise.resolve({ id: 1, ...data, items: [] });
      }),
      findFirst: jest.fn().mockResolvedValue('pedido' in extra ? extra.pedido : { id: 1, estado: 'PENDIENTE', comprobanteId: null }),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(actualizado, data);
        return Promise.resolve({ id: 1, ...data });
      }),
    },
    $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
  };
  const noop: any = new Proxy({}, { get: () => jest.fn() });
  return { service: new TiendaService(prisma, noop, noop, noop, noop, noop, noop), creado, actualizado, prisma };
}

describe('pedido con envío por agencia', () => {
  it('guarda courier, agencia y DNI; la agencia sirve de dirección', async () => {
    const { service, creado } = armar();
    await service.crearPedido('mi-tienda', {
      clienteNombre: 'Rosa',
      clienteTelefono: '999888777',
      tipoEntrega: 'ENVIO',
      medioPago: 'YAPE',
      items: [{ productoId: 7, cantidad: 1 }],
      envioCourier: 'OLVA',
      envioAgenciaId: 'CUS01',
      envioAgenciaNombre: 'Cusco - Av. Sol',
      clienteDocumento: '45678912',
    } as any);
    expect(creado).toMatchObject({
      envioCourier: 'OLVA',
      envioAgenciaId: 'CUS01',
      envioAgenciaNombre: 'Cusco - Av. Sol',
      clienteDocumento: '45678912',
      agenciaEnvio: 'Olva Courier - Cusco - Av. Sol',
      clienteDireccion: 'Olva Courier - Cusco - Av. Sol',
    });
  });

  it('sin DNI no entra', async () => {
    const { service } = armar();
    await expect(
      service.crearPedido('mi-tienda', {
        clienteNombre: 'Rosa', clienteTelefono: '999888777', tipoEntrega: 'ENVIO', medioPago: 'YAPE',
        items: [{ productoId: 7, cantidad: 1 }], envioCourier: 'SHALOM', envioAgenciaNombre: 'Cusco',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('vincularComprobante', () => {
  it('vincula el comprobante y confirma el pedido pendiente', async () => {
    const { service, actualizado, prisma } = armar();
    await service.vincularComprobante(85, 1, 900, 3);
    expect(actualizado).toMatchObject({ comprobanteId: 900, estado: 'CONFIRMADO', usuarioConfirma: 3 });
    expect(prisma.historialEstadoPedido.create.mock.calls[0][0].data.notas).toBe('Comprobante NV01-12');
  });

  it('no pisa un pedido que ya tiene otro comprobante', async () => {
    const { service } = armar({ pedido: { id: 1, estado: 'CONFIRMADO', comprobanteId: 555 } });
    await expect(service.vincularComprobante(85, 1, 900)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un comprobante de otra empresa no se encuentra', async () => {
    const { service } = armar({ comprobante: null });
    await expect(service.vincularComprobante(85, 1, 900)).rejects.toBeInstanceOf(NotFoundException);
  });
});
