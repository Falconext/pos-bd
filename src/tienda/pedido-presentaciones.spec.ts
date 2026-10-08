/**
 * Pedidos de tienda con presentaciones y variantes.
 *
 * El pedido cobraba SIEMPRE `producto.precioUnitario`, ignorando lo que el
 * comprador hubiera elegido: quien compraba un rollo de alfombra terminaba con
 * un pedido al precio del centímetro suelto. Este contrato fija que el precio
 * y la cantidad los resuelve el servidor a partir del código elegido, nunca el
 * navegador.
 *
 * Los números son los reales de TIENDA MINERA (empresa 88): el stock se lleva
 * en centímetros, "por metro" son 100 y el precio del paquete manda.
 */
import { BadRequestException } from '@nestjs/common';
import { TiendaService } from './tienda.service';

const SLUG = 'alvarado';

/** Alfombra acanalada gruesa: 1200 m de stock, metro a S/305.80, rollo a S/3250.75. */
const GRUESA = {
  id: 30699,
  descripcion: 'Alfombra acanalada gruesa',
  precioUnitario: 3.058,
  stock: 120000,
  atributosTecnicos: {},
};
const PRES_METRO = {
  codigo: 'ALFOMBRAAG-METRO',
  alias: 'Alfombra acanalada gruesa por metro lineal',
  unidadesPorPaquete: 100,
  precioPaquete: 305.8,
};
/** Rollo SIN precio propio: debe caer a unitario × unidades. */
const PRES_ROLLO_SIN_PRECIO = {
  codigo: 'ALFOMBRAAG-ROLLO',
  alias: 'Alfombra acanalada gruesa por rollo de 12 metros',
  unidadesPorPaquete: 1200,
  precioPaquete: null,
};
/** Alfombra fina: solo 25 cm de stock — no alcanza ni para un metro. */
const FINA = {
  id: 30707,
  descripcion: 'Alfombra acanalada fina',
  precioUnitario: 0.998,
  stock: 25,
  atributosTecnicos: {},
};
const PRES_FINA_METRO = {
  codigo: 'ALFOMBRAACANALADAFINA-METRO',
  alias: 'Alfombra acanalada fina x metro',
  unidadesPorPaquete: 100,
  precioPaquete: 99.8,
};

function armar(opts: { producto?: any; presentacion?: any; variante?: any } = {}) {
  const creado: any = { items: null };
  const prisma: any = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue({
        id: 88,
        costoEnvioFijo: 0,
        envioGratisDesdeSoles: 0,
        minimoCompra: 0,
        aceptaRecojo: true,
        aceptaEnvio: true,
        nombreComercial: 'TIENDA MINERA',
        razonSocial: 'TIENDA MINERA S.A.C.',
        mpConectado: false,
        plan: { tieneTienda: true },
      }),
    },
    producto: {
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.productoPadreId !== undefined
            ? (opts.variante ?? null)
            : (opts.producto ?? GRUESA),
        ),
      ),
    },
    productoCodigoBarras: {
      findFirst: jest.fn().mockResolvedValue(opts.presentacion ?? null),
    },
    historialEstadoPedido: { create: jest.fn().mockResolvedValue({}) },
    pedidoTienda: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        creado.items = data.items?.create ?? [];
        creado.subtotal = Number(data.subtotal);
        creado.total = Number(data.total);
        return Promise.resolve({ id: 1, ...data, items: [] });
      }),
    },
  };
  const noop: any = new Proxy({}, { get: () => jest.fn() });
  const service = new TiendaService(prisma, noop, noop, noop, noop, noop, noop);
  return { service, prisma, creado };
}

const pedido = (item: any) => ({
  clienteNombre: 'Diego',
  clienteTelefono: '991065217',
  tipoEntrega: 'RECOJO',
  medioPago: 'EFECTIVO',
  items: [item],
}) as any;

describe('Pedido de tienda · presentaciones', () => {
  it('cobra el precio del paquete, no el del centímetro suelto', async () => {
    const { service, creado } = armar({ presentacion: PRES_METRO });
    await service.crearPedido(SLUG, pedido({
      productoId: GRUESA.id, cantidad: 1, presentacionCodigo: PRES_METRO.codigo,
    }));
    expect(creado.subtotal).toBeCloseTo(305.8, 2);
  });

  it('descuenta el stock en unidades base (1 metro = 100 cm)', async () => {
    const { service, creado } = armar({ presentacion: PRES_METRO });
    await service.crearPedido(SLUG, pedido({
      productoId: GRUESA.id, cantidad: 1, presentacionCodigo: PRES_METRO.codigo,
    }));
    expect(creado.items[0].cantidad).toBe(100);
    expect(Number(creado.items[0].precioUnit)).toBeCloseTo(3.058, 4);
  });

  it('multiplica bien varias unidades de la misma presentación', async () => {
    const { service, creado } = armar({ presentacion: PRES_METRO });
    await service.crearPedido(SLUG, pedido({
      productoId: GRUESA.id, cantidad: 3, presentacionCodigo: PRES_METRO.codigo,
    }));
    expect(creado.items[0].cantidad).toBe(300);
    expect(creado.subtotal).toBeCloseTo(917.4, 2);
  });

  it('sin precio de paquete, cobra unitario × unidades', async () => {
    const { service, creado } = armar({ presentacion: PRES_ROLLO_SIN_PRECIO });
    await service.crearPedido(SLUG, pedido({
      productoId: GRUESA.id, cantidad: 1, presentacionCodigo: PRES_ROLLO_SIN_PRECIO.codigo,
    }));
    expect(creado.subtotal).toBeCloseTo(1200 * 3.058, 2);
  });

  it('deja rastro de qué se pidió en la observación', async () => {
    const { service, creado } = armar({ presentacion: PRES_METRO });
    await service.crearPedido(SLUG, pedido({
      productoId: GRUESA.id, cantidad: 2, presentacionCodigo: PRES_METRO.codigo,
    }));
    expect(creado.items[0].observacion).toContain('2 ×');
    expect(creado.items[0].observacion).toContain('por metro lineal');
  });

  it('rechaza la compra si el stock no alcanza para la presentación', async () => {
    // 25 cm en stock y un metro necesita 100: no se puede vender.
    const { service } = armar({ producto: FINA, presentacion: PRES_FINA_METRO });
    await expect(
      service.crearPedido(SLUG, pedido({
        productoId: FINA.id, cantidad: 1, presentacionCodigo: PRES_FINA_METRO.codigo,
      })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un código de presentación que no existe', async () => {
    const { service } = armar({ presentacion: null });
    await expect(
      service.crearPedido(SLUG, pedido({
        productoId: GRUESA.id, cantidad: 1, presentacionCodigo: 'INVENTADO',
      })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sin presentación se comporta igual que siempre', async () => {
    const { service, creado } = armar();
    await service.crearPedido(SLUG, pedido({ productoId: GRUESA.id, cantidad: 5 }));
    expect(creado.items[0].cantidad).toBe(5);
    expect(creado.subtotal).toBeCloseTo(5 * 3.058, 2);
  });
});

describe('Pedido de tienda · variantes', () => {
  const VARIANTE = {
    id: 777,
    descripcion: 'Alfombra acanalada gruesa — Roja',
    precioUnitario: 9.5,
    stock: 50,
    atributosTecnicos: {},
  };

  it('cobra el precio de la variante, no el del producto padre', async () => {
    const { service, creado } = armar({ variante: VARIANTE });
    await service.crearPedido(SLUG, pedido({
      productoId: GRUESA.id, cantidad: 2, varianteId: VARIANTE.id,
    }));
    // Antes esto daba 2 × 3.058 = 6.12 aunque la variante costara 9.50.
    expect(creado.subtotal).toBeCloseTo(19, 2);
    expect(creado.items[0].productoId).toBe(VARIANTE.id);
  });

  it('rechaza una variante que no pertenece al producto', async () => {
    const { service } = armar({ variante: null });
    await expect(
      service.crearPedido(SLUG, pedido({
        productoId: GRUESA.id, cantidad: 1, varianteId: 12345,
      })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('valida el stock contra la variante, no contra el padre', async () => {
    const { service } = armar({ variante: { ...VARIANTE, stock: 1 } });
    await expect(
      service.crearPedido(SLUG, pedido({
        productoId: GRUESA.id, cantidad: 5, varianteId: VARIANTE.id,
      })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
