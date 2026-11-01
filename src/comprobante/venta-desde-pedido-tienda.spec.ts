/**
 * Comprobante que documenta un pedido de la tienda (`pedidoTiendaId`):
 *   - sale de la sede del pedido o es un 409 antes de emitir;
 *   - si la tienda lo aceptó con "vender sin stock", la venta no se bloquea
 *     por stock aunque el mostrador no permita sobreventa;
 *   - sin pedido, la validación de stock es la de siempre.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ComprobanteService } from './comprobante.service';

function armar(
  opts: {
    pedido?: any;
    stockSede?: number | null;
    permitirVentaSinStock?: boolean;
    reservado?: number;
  } = {},
) {
  const service = Object.create(ComprobanteService.prototype) as any;
  service.prisma = {
    pedidoTienda: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'pedido' in opts
            ? opts.pedido
            : {
                estado: 'PENDIENTE',
                comprobanteId: null,
                sedeId: 2,
                sede: { nombre: 'Norte' },
                empresa: { tiendaVentaSinStock: true },
              },
        ),
    },
    sede: { findFirst: jest.fn().mockResolvedValue({ nombre: 'Centro' }) },
    empresa: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          permitirVentaSinStock: opts.permitirVentaSinStock ?? false,
        }),
    },
    producto: {
      findFirst: jest.fn().mockResolvedValue({
        id: 7,
        descripcion: 'Polo',
        stock: 10,
        atributosTecnicos: {},
        porcentajeProvision: 0,
        factorConversion: 1,
      }),
    },
    productoStock: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.stockSede === null ? null : { stock: opts.stockSede ?? 2 },
        ),
    },
    reserva: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { cantidad: opts.reservado ?? 0 } }),
    },
  };
  return service;
}

describe('Venta desde un pedido de la tienda', () => {
  it('sin pedido no consulta nada y no cambia la regla', async () => {
    const s = armar();
    await expect(
      s.reglasVentaDesdePedidoTienda(9, undefined, 1),
    ).resolves.toEqual({ permitirSinStock: false });
    expect(s.prisma.pedidoTienda.findFirst).not.toHaveBeenCalled();
  });

  it('pedido de Norte emitido en Centro → 409 antes de crear el comprobante', async () => {
    const s = armar();
    await expect(
      s.reglasVentaDesdePedidoTienda(9, 41, 1),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(s.reglasVentaDesdePedidoTienda(9, 41, 1)).rejects.toThrow(
      'Este pedido es de la sede Norte y el comprobante salió de Centro.',
    );
  });

  it('misma sede y tienda con "vender sin stock": habilita la sobreventa solo para esta venta', async () => {
    const s = armar();
    await expect(s.reglasVentaDesdePedidoTienda(9, 41, 2)).resolves.toEqual({
      permitirSinStock: true,
    });
  });

  it('pedido sin sede (TODAS): cualquier sede', async () => {
    const s = armar({
      pedido: {
        estado: 'PENDIENTE',
        comprobanteId: null,
        sedeId: null,
        sede: null,
        empresa: { tiendaVentaSinStock: false },
      },
    });
    await expect(s.reglasVentaDesdePedidoTienda(9, 41, 1)).resolves.toEqual({
      permitirSinStock: false,
    });
  });

  it('pedido inexistente, cancelado o ya documentado', async () => {
    await expect(
      armar({ pedido: null }).reglasVentaDesdePedidoTienda(9, 41, 1),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      armar({
        pedido: {
          estado: 'CANCELADO',
          comprobanteId: null,
          sedeId: null,
          empresa: {},
        },
      }).reglasVentaDesdePedidoTienda(9, 41, 1),
    ).rejects.toThrow('El pedido está cancelado.');
    await expect(
      armar({
        pedido: {
          estado: 'CONFIRMADO',
          comprobanteId: 5,
          sedeId: null,
          empresa: {},
        },
      }).reglasVentaDesdePedidoTienda(9, 41, 1),
    ).rejects.toThrow('Este pedido ya tiene su comprobante.');
    await expect(
      armar().reglasVentaDesdePedidoTienda(9, 'abc', 1),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validación de stock: sin el permiso del pedido bloquea; con él deja pasar', async () => {
    const detalles = [{ productoId: 7, cantidad: 5 }];
    const s = armar({ stockSede: 2 });
    await expect(
      s.validarStockDisponibleParaVenta(detalles, { empresaId: 9, sedeId: 2 }),
    ).rejects.toThrow(
      'Stock no disponible para venta en "Polo". Disponible para venta: 2, solicitado: 5.',
    );
    await expect(
      s.validarStockDisponibleParaVenta(detalles, {
        empresaId: 9,
        sedeId: 2,
        permitirSinStock: true,
      }),
    ).resolves.toBe(2);
  });

  it('la regla de stock del punto de venta no cambió: reservas y provisión con el helper común', async () => {
    const s = armar({ stockSede: 6, reservado: 2 });
    await expect(
      s.validarStockDisponibleParaVenta([{ productoId: 7, cantidad: 4 }], {
        empresaId: 9,
        sedeId: 2,
      }),
    ).resolves.toBe(2);
    await expect(
      s.validarStockDisponibleParaVenta([{ productoId: 7, cantidad: 5 }], {
        empresaId: 9,
        sedeId: 2,
      }),
    ).rejects.toThrow('Disponible para venta: 4');
    // Sin fila en la sede el mostrador sigue cayendo a Producto.stock (sin cambios).
    const sinFila = armar({ stockSede: null });
    await expect(
      sinFila.validarStockDisponibleParaVenta(
        [{ productoId: 7, cantidad: 9 }],
        { empresaId: 9, sedeId: 2 },
      ),
    ).resolves.toBe(2);
  });
});
