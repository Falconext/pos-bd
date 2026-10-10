/**
 * Aceptar pedidos de productos agotados en la tienda online.
 *
 * Hay negocios que trabajan por encargo: prefieren recibir el pedido y después
 * traer el producto, antes que perder la venta porque el stock está en cero. El
 * ajuste es propio de la tienda y NO el de sobreventa del mostrador
 * (`permitirVentaSinStock`): se puede querer uno sin el otro.
 *
 * Lo que se fija acá: que apagado siga bloqueando como siempre, que encendido
 * deje pasar el pedido, y que encenderlo no se lleve por delante las otras
 * validaciones — sigue sin poder pedirse un producto inexistente ni una
 * presentación que no existe.
 */
import { BadRequestException } from '@nestjs/common';
import { TiendaService } from './tienda.service';

const SLUG = 'mi-tienda';

/** Producto agotado: 0 en stock. */
const AGOTADO = {
  id: 501,
  descripcion: 'Cámara de seguridad',
  precioUnitario: 89,
  stock: 0,
  atributosTecnicos: {},
};

function armar(opts: { sinStock?: boolean; producto?: any; presentacion?: any } = {}) {
  // `null` explícito significa "no existe"; si no se pasa la clave, va el agotado.
  const productoMock = 'producto' in opts ? opts.producto : AGOTADO;
  const creado: any = {};
  const prisma: any = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue({
        id: 85,
        costoEnvioFijo: 0,
        envioGratisDesdeSoles: 0,
        minimoCompra: 0,
        aceptaRecojo: true,
        aceptaEnvio: true,
        tiendaVentaSinStock: opts.sinStock ?? false,
        nombreComercial: 'Mi Tienda',
        razonSocial: 'MI TIENDA S.A.C.',
        mpConectado: false,
        plan: { tieneTienda: true },
      }),
    },
    producto: {
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.productoPadreId !== undefined ? null : productoMock),
      ),
    },
    productoCodigoBarras: { findFirst: jest.fn().mockResolvedValue(opts.presentacion ?? null) },
    historialEstadoPedido: { create: jest.fn().mockResolvedValue({}) },
    pedidoTienda: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        creado.items = data.items?.create ?? [];
        creado.subtotal = Number(data.subtotal);
        return Promise.resolve({ id: 1, ...data, items: [] });
      }),
    },
  };
  const noop: any = new Proxy({}, { get: () => jest.fn() });
  return { service: new TiendaService(prisma, noop, noop, noop, noop, noop, noop), creado };
}

const pedido = (item: any) => ({
  clienteNombre: 'Cliente',
  clienteTelefono: '999888777',
  tipoEntrega: 'RECOJO',
  medioPago: 'EFECTIVO',
  items: [item],
}) as any;

describe('Tienda · aceptar pedidos sin stock', () => {
  it('apagado: un producto agotado sigue rechazándose', async () => {
    const { service } = armar({ sinStock: false });
    await expect(
      service.crearPedido(SLUG, pedido({ productoId: AGOTADO.id, cantidad: 1 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('encendido: el pedido del producto agotado entra', async () => {
    const { service, creado } = armar({ sinStock: true });
    await service.crearPedido(SLUG, pedido({ productoId: AGOTADO.id, cantidad: 2 }));
    expect(creado.items[0].cantidad).toBe(2);
    expect(creado.subtotal).toBeCloseTo(178, 2);
  });

  it('encendido: también deja pedir más de lo que hay', async () => {
    const { service, creado } = armar({ sinStock: true, producto: { ...AGOTADO, stock: 3 } });
    await service.crearPedido(SLUG, pedido({ productoId: AGOTADO.id, cantidad: 10 }));
    expect(creado.items[0].cantidad).toBe(10);
  });

  it('apagado: pedir más de lo que hay se sigue rechazando', async () => {
    const { service } = armar({ sinStock: false, producto: { ...AGOTADO, stock: 3 } });
    await expect(
      service.crearPedido(SLUG, pedido({ productoId: AGOTADO.id, cantidad: 10 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('con stock de sobra, el ajuste no cambia nada', async () => {
    const { service, creado } = armar({ sinStock: false, producto: { ...AGOTADO, stock: 50 } });
    await service.crearPedido(SLUG, pedido({ productoId: AGOTADO.id, cantidad: 2 }));
    expect(creado.items[0].cantidad).toBe(2);
  });

  it('encendido: una presentación agotada también se acepta, con sus unidades', async () => {
    const PRES = { codigo: 'CAJA-12', alias: 'Caja de 12', unidadesPorPaquete: 12, precioPaquete: 900 };
    const { service, creado } = armar({ sinStock: true, presentacion: PRES });
    await service.crearPedido(SLUG, pedido({
      productoId: AGOTADO.id, cantidad: 1, presentacionCodigo: PRES.codigo,
    }));
    expect(creado.items[0].cantidad).toBe(12);
    expect(creado.subtotal).toBeCloseTo(900, 2);
  });

  it('encendido NO relaja lo demás: un producto que no existe se sigue rechazando', async () => {
    const { service } = armar({ sinStock: true, producto: null });
    await expect(
      service.crearPedido(SLUG, pedido({ productoId: 99999, cantidad: 1 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('encendido NO relaja lo demás: una presentación inventada se sigue rechazando', async () => {
    const { service } = armar({ sinStock: true, presentacion: null });
    await expect(
      service.crearPedido(SLUG, pedido({
        productoId: AGOTADO.id, cantidad: 1, presentacionCodigo: 'NO-EXISTE',
      })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * La tienda pública tiene que recibir la política, no solo obedecerla.
 *
 * El empresario marcó "Acepto pedidos de productos agotados" y sus productos
 * seguían saliendo "Agotado": el backend habría aceptado el pedido, pero
 * `/public/store/:slug` no devolvía el campo, así que la plantilla no tenía
 * cómo enterarse y bloqueaba la compra antes de intentarlo.
 */
describe('La tienda pública expone la política de stock', () => {
  it('obtenerTiendaPorSlug selecciona tiendaVentaSinStock', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(__dirname + '/tienda.service.ts', 'utf-8');
    const desde = src.indexOf('async obtenerTiendaPorSlug');
    expect(desde).toBeGreaterThan(-1);
    // El select del método, hasta donde empieza el siguiente método.
    const hasta = src.indexOf('\n  async ', desde + 10);
    const metodo = src.slice(desde, hasta === -1 ? undefined : hasta);
    expect(metodo).toContain('tiendaVentaSinStock: true');
  });
});
