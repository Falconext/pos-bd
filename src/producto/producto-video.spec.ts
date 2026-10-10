/**
 * El video del producto tiene que guardarse.
 *
 * El empresario pegaba el enlace de TikTok en "Video del producto", guardaba, y
 * al volver a abrir la ficha el campo salía vacío. El campo existía en el
 * formulario, en el DTO y en la base; lo que faltaba era escribirlo: el `data`
 * de `prisma.producto.update` se arma campo por campo y `videoUrl` no estaba en
 * la lista, así que el valor se descartaba sin error.
 *
 * Al descubrirlo había 22.668 productos en producción y ninguno con video.
 * Es el mismo defecto que ya nos pasó con el SKU, con precios mayorista y con
 * el alias del cliente: un campo que se ve, se escribe y se pierde.
 */
import { ProductoService } from './producto.service';

function armar(existente: any = { id: 1, empresaId: 1, stock: 0, precioUnitario: 10 }) {
  const guardado: any = {};
  const prisma: any = {
    producto: {
      findFirst: jest.fn().mockResolvedValue(existente),
      findUnique: jest.fn().mockResolvedValue(existente),
      update: jest.fn().mockImplementation(({ data }: any) => {
        guardado.update = data;
        return Promise.resolve({ ...existente, ...data });
      }),
      create: jest.fn().mockImplementation(({ data }: any) => {
        guardado.create = data;
        return Promise.resolve({ id: 1, ...data });
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn().mockImplementation((fn: any) =>
      typeof fn === 'function' ? fn(prisma) : Promise.all(fn),
    ),
  };
  const noop: any = new Proxy({}, { get: () => jest.fn() });
  const service: any = Object.create(ProductoService.prototype);
  service.prisma = prisma;
  return { service, prisma, guardado };
}

/** Lo que el servicio realmente le manda a Prisma al actualizar. */
function dataDeUpdate(service: any, guardado: any, videoUrl: any) {
  return ProductoService.prototype.actualizar
    .call(service, { id: 1, empresaId: 1, videoUrl } as any)
    .catch(() => {})
    .then(() => guardado.update);
}

describe('Video del producto · se guarda al editar', () => {
  it('el enlace de TikTok llega a la base', async () => {
    const { service, guardado } = armar();
    const d = await dataDeUpdate(service, guardado, 'https://www.tiktok.com/@ecooro/video/7650171597617319188');
    expect(d?.videoUrl).toBe('https://www.tiktok.com/@ecooro/video/7650171597617319188');
  });

  it('se limpian los espacios sobrantes al pegar', async () => {
    const { service, guardado } = armar();
    const d = await dataDeUpdate(service, guardado, '  https://youtu.be/abc123  ');
    expect(d?.videoUrl).toBe('https://youtu.be/abc123');
  });

  it('borrar el campo deja el video en nulo, no en cadena vacía', async () => {
    const { service, guardado } = armar();
    const d = await dataDeUpdate(service, guardado, '');
    expect(d?.videoUrl).toBeNull();
  });

  it('si no se manda el campo, no se pisa el video que ya tenía', async () => {
    const { service, guardado } = armar();
    await ProductoService.prototype.actualizar
      .call(service, { id: 1, empresaId: 1, descripcion: 'Otro nombre' } as any)
      .catch(() => {});
    expect(guardado.update?.videoUrl).toBeUndefined();
  });
});
