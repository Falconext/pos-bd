/**
 * Lo que va bajo reserva no se pide sin un pago antes.
 *
 * Bajo reserva es lo que el negocio consigue con su proveedor solo para ese
 * cliente: si se lo trae y el cliente no compra, el producto se queda en el
 * local. Hierba Sana lo definió el 20-10: para pedirlo, el cliente paga antes
 * al menos algo (la reserva, o el adelanto si es de provincia). Cuánto, lo
 * dice su contexto; el código solo exige que haya un pago.
 */
import { LeadsPedidoService } from './leads-pedido.service';
import { CONFIG_ENVIO_HIERBA_SANA } from './envio-zonas';
import { REGLAS_HIERBA_SANA } from './reglas-descuento';

const EMPRESA = 89;
const CONV = 300;

const CATALOGO = [
  { id: 1, descripcion: 'Moringa 100 cápsulas', precioUnitario: 31, disponibilidad: 'INMEDIATA', stock: 50 },
  { id: 2, descripcion: 'Maca negra 500 gr', precioUnitario: 45, disponibilidad: 'BAJO_PEDIDO', stock: 50 },
];

function armar(opts: { items?: any[]; pagos?: number[]; zona?: string } = {}) {
  const items = opts.items ?? [{ productoId: 2, cantidad: 1 }];
  const borrador: any = {
    tipoZona: opts.zona ?? 'DOMICILIO',
    zona: 'Lima',
    lugar: 'Miraflores',
    nombre: 'Diego Ortega',
    dni: null,
    celular: '991065217',
    direccion: 'Av. Larco 123',
    referencia: 'frente al parque',
    agenciaSede: null,
    horario: 'mañana a las 4',
    costoEnvio: opts.zona === 'RECOJO' ? 0 : 15,
    itemsJson: items,
    comprobanteId: null,
  };
  const prisma: any = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue({
        iaVentasConfigJson: { envio: CONFIG_ENVIO_HIERBA_SANA, descuento: REGLAS_HIERBA_SANA },
      }),
    },
    leadPedidoBorrador: {
      findUnique: jest.fn(() => Promise.resolve(borrador)),
      update: jest.fn(({ data }: any) => {
        Object.assign(borrador, data);
        return Promise.resolve(borrador);
      }),
    },
    producto: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          CATALOGO.filter((p) => !where?.id?.in || where.id.in.includes(p.id)),
        ),
      ),
    },
    cliente: { findFirst: jest.fn().mockResolvedValue({ id: 7, telefono: '991065217' }) },
    leadProspecto: { findFirst: jest.fn().mockResolvedValue(null) },
    leadComprobantePago: {
      findMany: jest
        .fn()
        .mockResolvedValue((opts.pagos ?? []).map((m) => ({ montoLeido: m, medioLeido: 'YAPE' }))),
    },
  };
  const comprobante: any = {
    crearInformal: jest.fn().mockResolvedValue({ id: 500, serie: 'NV01', correlativo: 9 }),
  };
  const notificaciones: any = { notificarAdminsEmpresa: jest.fn().mockResolvedValue(undefined) };
  const servicio = new LeadsPedidoService(
    prisma,
    comprobante,
    { create: jest.fn().mockResolvedValue({}) } as any,
    notificaciones,
  );
  return { servicio, comprobante, notificaciones };
}

describe('registrar un pedido con algo bajo reserva', () => {
  it('sin ningún pago NO se registra, y el modelo sabe qué pedir', async () => {
    const { servicio, comprobante } = armar();
    const r = await servicio.registrarPedido(EMPRESA, CONV, '51991065217');

    expect(r.pedido).toBeUndefined();
    expect(comprobante.crearInformal).not.toHaveBeenCalled();
    expect(r.error).toMatch(/NO se registró/);
    expect(r.error).toMatch(/Maca negra/);
    expect(r.error).toMatch(/reserva/);
    expect(r.error).toMatch(/No le digas que su pedido quedó registrado/);
  });

  it('con cualquier pago ya leído se registra: el monto lo fija el negocio', async () => {
    const { servicio, comprobante } = armar({ pagos: [5] });
    const r = await servicio.registrarPedido(EMPRESA, CONV, '51991065217');

    expect(comprobante.crearInformal).toHaveBeenCalled();
    expect(r.error).toBeUndefined();
    expect(r.pedido).toBeDefined();
  });

  it('lo que está disponible de inmediato se registra como siempre, sin pago', async () => {
    const { servicio, comprobante } = armar({ items: [{ productoId: 1, cantidad: 1 }] });
    await servicio.registrarPedido(EMPRESA, CONV, '51991065217');
    expect(comprobante.crearInformal).toHaveBeenCalled();
  });

  it('en recojo en tienda no se avisa a la tienda sin el pago', async () => {
    const { servicio, notificaciones, comprobante } = armar({ zona: 'RECOJO' });
    const r = await servicio.avisarVisitaTienda(EMPRESA, CONV, '51991065217', 'mañana a las 5');

    expect(r.avisado).toBeUndefined();
    expect(r.error).toMatch(/bajo reserva/);
    expect(notificaciones.notificarAdminsEmpresa).not.toHaveBeenCalled();
    expect(comprobante.crearInformal).not.toHaveBeenCalled();
  });
});

describe('la cotización con algo bajo reserva', () => {
  it('le dice al modelo cuál va bajo reserva y que pida el pago', async () => {
    const { servicio } = armar();
    const r = await servicio.cotizar(EMPRESA, CONV, [
      { productoId: 1, cantidad: 1 },
      { productoId: 2, cantidad: 1 },
    ]);
    expect(r.texto).toBeDefined();
    expect(r.bajoReserva).toMatch(/^Maca negra 500 gr va bajo reserva/);
    expect(r.bajoReserva).not.toMatch(/Moringa/);
    expect(r.bajoReserva).toMatch(/pagar antes/);
  });

  it('sin nada bajo reserva no agrega la nota', async () => {
    const { servicio } = armar();
    const r = await servicio.cotizar(EMPRESA, CONV, [{ productoId: 1, cantidad: 1 }]);
    expect(r.bajoReserva).toBeUndefined();
  });
});
