import { ProductoService } from './producto.service';

/**
 * Buscar una variante escribiendo la frase natural: "Victoria azul talla 35".
 *
 * El buscador exige que CADA palabra aparezca en algún campo del producto. La
 * variante se llama "Victoria Azul - Azul / 35 / 7": no dice "talla" en ninguna
 * parte, así que esa sola palabra hacía caer la búsqueda entera a cero — es
 * literalmente lo que reportó el cliente.
 *
 * "talla" es el NOMBRE del atributo y "35" su valor. Ambos viven en
 * `valoresAtributos`, así que la palabra también vale si aparece ahí.
 */
describe('Buscar variantes por sus atributos', () => {
  const montar = (idsPorPalabra: Record<string, number[]>) => {
    const prisma = {
      $queryRaw: jest.fn((_strings: any, _empresaId: any, like: string) => {
        const palabra = String(like).replace(/%/g, '').toLowerCase();
        return Promise.resolve((idsPorPalabra[palabra] ?? []).map((id) => ({ id })));
      }),
    };
    return new ProductoService(prisma as any, {} as any, {} as any, {} as any);
  };

  const condiciones = (service: ProductoService, frase: string) =>
    (service as any).busquedaPorPalabrasConAtributos(frase, 86);

  it('"talla" ya no mata la búsqueda: la cumple el atributo', async () => {
    const service = montar({ talla: [30011, 30012], '35': [30011] });
    const [, , porTalla] = await condiciones(service, 'Victoria azul talla 35');

    // Antes esta palabra solo podía mirar descripción y código, donde "talla"
    // no está, y el AND de palabras devolvía cero.
    expect(porTalla.OR).toContainEqual({ id: { in: [30011, 30012] } });
  });

  it('cada palabra sigue teniendo que aparecer en algún lado', async () => {
    const service = montar({});
    const partes = await condiciones(service, 'Victoria azul');

    expect(partes).toHaveLength(2);
    // Sin coincidencia por atributo, la palabra queda con los campos de siempre.
    partes.forEach((p: any) =>
      expect(p.OR.some((c: any) => c.descripcion)).toBe(true),
    );
  });

  it('una palabra que comparten todas las variantes no las excluye', async () => {
    // El tope evita armar un IN gigantesco; si se truncara la lista, la palabra
    // dejaría fuera variantes al azar.
    const tope = (ProductoService as any).TOPE_IDS_ATRIBUTO;
    const service = montar({ color: Array.from({ length: tope }, (_, i) => i + 1) });
    const [porColor] = await condiciones(service, 'color');

    expect(porColor.OR).toContainEqual({ productoPadreId: { not: null } });
  });

  it('los comodines de LIKE se escapan', async () => {
    const service = montar({});
    await condiciones(service, '50%');

    // Sin escapar, "50%" traería cualquier cosa que empiece con 50.
    const like = (service as any).prisma.$queryRaw.mock.calls[0][2];
    expect(like).toBe('%50\\%%');
  });

  it('sin término de búsqueda no hay condiciones', async () => {
    const service = montar({});
    await expect(condiciones(service, '   ')).resolves.toBeUndefined();
  });
});
