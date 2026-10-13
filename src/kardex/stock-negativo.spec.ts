import { KardexService } from './kardex.service';

/**
 * Una salida que no alcanza el stock.
 *
 * Caso real (COMERCIAL LINNA MODA): vendieron un calzado talla 37 cuando el
 * stock estaba en 0. El movimiento quedó registrado —"SALIDA 1, antes 0,
 * después 0"— pero el descuento se descartó. Dos días después entró la compra
 * de 2 unidades y el inventario quedó en 2 cuando debía decir 1. El error no
 * se corrige solo: queda inflado para siempre.
 *
 * Pasó 641 veces en 8 empresas. Lo que decide qué hacer es si el negocio lleva
 * inventario: quien lo lleva necesita el negativo (se neta al comprar), y quien
 * factura siempre contra stock 0 necesita el recorte (si no, −16.400 de ruido).
 */
describe('Salida sin stock suficiente', () => {
  const montar = (permiteNegativo: boolean, stockPrevio = 0) => {
    const updates: any[] = [];
    const prisma = {
      productoStock: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }), // nunca alcanza
        findUnique: jest.fn().mockResolvedValue({ stock: stockPrevio }),
        update: jest.fn((a: any) => { updates.push(a.data); return Promise.resolve({}); }),
      },
      empresa: {
        findUnique: jest.fn().mockResolvedValue({ permitirStockNegativo: permiteNegativo }),
      },
      producto: { findUnique: jest.fn().mockResolvedValue({ costoPromedio: 0 }), update: jest.fn() },
      aggregate: jest.fn(),
    };
    (prisma.productoStock as any).aggregate = jest.fn().mockResolvedValue({ _sum: { stock: 0 } });
    const service = new KardexService(prisma as any, {} as any, {} as any);
    return { service, prisma, updates };
  };

  const aplicar = (s: any, cantidad: number) =>
    s.actualizarStockYCosto(30173, 67, -cantidad, 'SALIDA', 0, cantidad, 86);

  it('con stock negativo permitido, descuenta de verdad', async () => {
    const { service, updates } = montar(true);
    await aplicar(service, 1);
    // −1 significa "debo una unidad": al entrar la compra de 2 queda 1.
    expect(updates).toContainEqual({ stock: { decrement: 1 } });
  });

  it('con stock negativo permitido no reporta faltante', async () => {
    const { service } = montar(true);
    await expect(aplicar(service, 1)).resolves.toBe(0);
  });

  it('sin permitirlo, recorta a 0 como siempre', async () => {
    const { service, updates } = montar(false);
    await aplicar(service, 1);
    expect(updates).toContainEqual({ stock: 0 });
  });

  it('sin permitirlo, DEVUELVE lo que no se pudo descontar', async () => {
    // Es lo que permite dejarlo anotado en el movimiento. Antes el error era
    // invisible: la fila decía "salió 1" con el stock intacto.
    const { service } = montar(false);
    await expect(aplicar(service, 1)).resolves.toBe(1);
  });

  it('el faltante es solo la parte que no alcanzó', async () => {
    // Había 2, se vendieron 5: faltan 3, no 5.
    const { service } = montar(false, 2);
    await expect(aplicar(service, 5)).resolves.toBe(3);
  });

  it('sin empresaId no asume que se permite', async () => {
    // Un camino viejo que no pase la empresa no debe habilitar el negativo.
    const { service, updates } = montar(true);
    await (service as any).actualizarStockYCosto(30173, 67, -1, 'SALIDA', 0, 1, undefined);
    expect(updates).toContainEqual({ stock: 0 });
  });
});
