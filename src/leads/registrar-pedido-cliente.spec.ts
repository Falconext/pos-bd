/**
 * El pedido se registra a nombre de un cliente real.
 *
 * Esto existe porque `registrar_pedido` NUNCA funcionó, para nadie, y solo se
 * vio probándolo de punta a punta en producción: `crearInformal` resuelve el
 * cliente por nombre SOLO cuando es exactamente "CLIENTES VARIOS"; con
 * cualquier otro y sin `clienteId` lanza "clienteId es requerido". Como el
 * flujo exige el nombre del cliente antes de registrar, el registro fallaba
 * siempre — y el bot derivaba a un asesor, que es un fallo elegante pero
 * fallo.
 */
import { LeadsPedidoService } from './leads-pedido.service';

function prismaFalso(over: Record<string, unknown> = {}) {
  const creados: Record<string, unknown>[] = [];
  const actualizados: Record<string, unknown>[] = [];
  return {
    creados,
    actualizados,
    cliente: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: any) => {
        creados.push(data);
        return Promise.resolve({ id: 777 });
      }),
      update: jest.fn(({ data }: any) => {
        actualizados.push(data);
        return Promise.resolve({});
      }),
    },
    tipoDocumento: {
      findFirst: jest.fn().mockResolvedValue({ id: 1 }),
    },
    ...over,
  } as any;
}

const servicio = (prisma: any) =>
  new LeadsPedidoService(prisma, {} as never, {} as never, {} as never);

const resolver = (prisma: any, borrador: any, tel = '51999888777') =>
  (servicio(prisma) as any).clienteDelPedido(89, borrador, tel);

const BORRADOR = {
  nombre: 'Edwing Ortega',
  dni: '44556677',
  celular: '915947349',
};

describe('a quién se le factura el pedido', () => {
  it('si el cliente ya existe por DNI, lo reusa', async () => {
    const prisma = prismaFalso();
    prisma.cliente.findFirst.mockResolvedValueOnce({ id: 42, telefono: '915947349' });
    expect(await resolver(prisma, BORRADOR)).toBe(42);
    expect(prisma.cliente.create).not.toHaveBeenCalled();
  });

  it('y le completa el celular si no lo tenía', async () => {
    // El aviso de entrega sale del teléfono de la FICHA, no del celular del
    // envío: sin esto, al cliente no le llega el "ya salió tu pedido".
    const prisma = prismaFalso();
    prisma.cliente.findFirst.mockResolvedValueOnce({ id: 42, telefono: null });
    await resolver(prisma, BORRADOR);
    expect(prisma.actualizados[0]).toEqual({ telefono: '915947349' });
  });

  it('sin DNI, lo busca por teléfono', async () => {
    // Sin DNI no hay búsqueda por documento: la primera consulta ya es la del
    // teléfono.
    const prisma = prismaFalso();
    prisma.cliente.findFirst.mockResolvedValueOnce({ id: 55 });
    expect(await resolver(prisma, { ...BORRADOR, dni: null })).toBe(55);
    expect(prisma.cliente.findFirst).toHaveBeenCalledTimes(1);
  });

  it('si no existe, lo crea con lo que dio en el chat', async () => {
    const prisma = prismaFalso();
    expect(await resolver(prisma, BORRADOR)).toBe(777);
    expect(prisma.creados[0]).toMatchObject({
      empresaId: 89,
      nombre: 'EDWING ORTEGA',
      nroDoc: '44556677',
      telefono: '915947349',
      tipoDocumentoId: 1,
    });
  });

  it('sin DNI guarda el celular como documento, como ya hace el sistema', async () => {
    const prisma = prismaFalso();
    await resolver(prisma, { ...BORRADOR, dni: null });
    expect(prisma.creados[0]).toMatchObject({ nroDoc: '915947349' });
    // Sin DNI no se le pone tipo de documento: no sería un DNI.
    expect(prisma.creados[0].tipoDocumentoId).toBeUndefined();
  });

  it('sin celular propio usa el número del que escribe', async () => {
    const prisma = prismaFalso();
    await resolver(prisma, { ...BORRADOR, dni: null, celular: null }, '51987654321');
    expect(prisma.creados[0]).toMatchObject({ nroDoc: '51987654321' });
  });

  it('sin nombre no inventa una ficha', async () => {
    const prisma = prismaFalso();
    expect(await resolver(prisma, { nombre: null, dni: null, celular: null }, '')).toBeNull();
    expect(prisma.cliente.create).not.toHaveBeenCalled();
  });

  it('si crear el cliente falla, NO se pierde la venta', async () => {
    // Devuelve null y el pedido se registra a CLIENTES VARIOS.
    const prisma = prismaFalso();
    prisma.cliente.create.mockRejectedValue(new Error('BD caída'));
    expect(await resolver(prisma, BORRADOR)).toBeNull();
  });
});
