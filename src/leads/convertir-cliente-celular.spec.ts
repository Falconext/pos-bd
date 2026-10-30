import { LeadsService } from './leads.service';

/**
 * "Convertir a cliente" no duplica (Krezka 30-10): si ya hay un cliente con
 * ese celular, se une con ese en vez de crear otro con DNI 00000000.
 */
function armar(clientePorCelular: { id: number } | null) {
  const prisma: any = {
    leadProspecto: {
      findFirst: jest.fn().mockResolvedValue({ id: 5, nombreProspecto: 'Greee', telefonoProspecto: '51948050978', clienteId: null }),
      update: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue(clientePorCelular ? [clientePorCelular] : []),
    cliente: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, nombre: 'Carrion Chambilla, Grecia Ivonne' })) },
  };
  const clientes: any = { crear: jest.fn().mockResolvedValue({ id: 99, nombre: 'Greee' }) };
  const service = Object.create(LeadsService.prototype) as LeadsService;
  Object.assign(service, { prisma, clientes });
  return { service, prisma, clientes };
}

describe('convertir a cliente', () => {
  it('con un cliente de ese celular: se une y no crea otro', async () => {
    const { service, prisma, clientes } = armar({ id: 41 });
    const r: any = await service.convertirACliente(7, 5);
    expect(clientes.crear).not.toHaveBeenCalled();
    expect(prisma.leadProspecto.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { clienteId: 41, estado: 'CONVERTIDO' } });
    expect(r).toMatchObject({ yaExistia: true, unidoPorCelular: true, cliente: { id: 41 } });
    // Busca por los 9 dígitos, sin importar cómo esté escrito.
    expect(prisma.$queryRaw.mock.calls[0]).toContain('948050978');
  });

  it('sin cliente con ese celular: lo crea como antes', async () => {
    const { service, clientes } = armar(null);
    const r: any = await service.convertirACliente(7, 5);
    expect(clientes.crear).toHaveBeenCalledWith(expect.objectContaining({ nroDoc: '00000000', telefono: '51948050978' }));
    expect(r).toMatchObject({ yaExistia: false, cliente: { id: 99 } });
  });
});
