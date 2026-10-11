/**
 * Reintentar un documento del RAG que quedó en error.
 *
 * Antes la única salida era borrarlo y volver a subirlo. Con un PDF de 40
 * páginas o una URL larga eso es rehacer el trabajo, y por un fallo que casi
 * siempre es pasajero: la cuota de Gemini o un timeout.
 */
import { LeadsService } from './leads.service';

function armar(doc: Record<string, unknown> | null) {
  const borrados: unknown[] = [];
  const actualizados: Record<string, unknown>[] = [];
  const indexados: number[] = [];
  const prisma = {
    leadDocumento: {
      findFirst: jest.fn().mockResolvedValue(doc),
      findUnique: jest.fn().mockResolvedValue({ id: 7, estado: 'INDEXADO' }),
      update: jest.fn(({ data }: any) => {
        actualizados.push(data);
        return Promise.resolve({});
      }),
    },
    leadFragmento: {
      deleteMany: jest.fn((a: any) => {
        borrados.push(a.where);
        return Promise.resolve({ count: 3 });
      }),
    },
  } as never;
  const rag = {
    indexarDocumento: jest.fn((id: number) => {
      indexados.push(id);
      return Promise.resolve();
    }),
  } as never;
  const servicio = new LeadsService(prisma, rag, {} as never, {} as never);
  return { servicio, prisma, rag, borrados, actualizados, indexados };
}

const DOC = { id: 7, contenido: 'texto largo del documento', estado: 'ERROR', titulo: 'Base V3' };

describe('reintentar un documento en error', () => {
  it('lo vuelve a indexar con el texto que ya estaba guardado', async () => {
    const a = armar(DOC);
    await a.servicio.reindexarDocumento(89, 7);
    expect(a.indexados).toEqual([7]);
    // No se vuelve a extraer ni a descargar nada: el contenido ya está.
    expect((a.rag as any).indexarDocumento).toHaveBeenCalledWith(
      7,
      'texto largo del documento',
    );
  });

  it('borra los fragmentos viejos antes', async () => {
    // Si el intento anterior quedó a medias, reindexar sin limpiar dejaría
    // el documento duplicado en las búsquedas del RAG.
    const a = armar(DOC);
    await a.servicio.reindexarDocumento(89, 7);
    expect(a.borrados).toEqual([{ documentoId: 7 }]);
  });

  it('lo deja PENDIENTE y le borra el error mientras reintenta', async () => {
    const a = armar(DOC);
    await a.servicio.reindexarDocumento(89, 7);
    expect(a.actualizados[0]).toEqual({ estado: 'PENDIENTE', error: null });
  });

  it('un documento sin texto NO se reintenta: hay que volver a subirlo', async () => {
    // El fallo fue al extraer el texto, no al indexarlo. Reintentar
    // indexaría la nada y lo dejaría "entrenado" sin contenido.
    const a = armar({ ...DOC, contenido: '   ' });
    await expect(a.servicio.reindexarDocumento(89, 7)).rejects.toThrow(
      /vuelve a subirlo/i,
    );
    expect(a.indexados).toHaveLength(0);
  });

  it('un documento de otra empresa no existe', async () => {
    const a = armar(null);
    await expect(a.servicio.reindexarDocumento(89, 7)).rejects.toThrow(
      /no encontrado/i,
    );
  });
});
