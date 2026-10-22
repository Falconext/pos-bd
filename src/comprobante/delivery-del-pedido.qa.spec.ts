/**
 * El delivery de un pedido del chat no se factura (2026-10-22), contra
 * PostgreSQL real y el servicio real de emisión — sin mocks del camino.
 *
 * La nota de venta del bot lleva la línea "ENVÍO DELIVERY" para cuadrar con la
 * cotización y el adelanto. La contadora de Hierba Sana pidió que el delivery
 * NO sume al total de la boleta ni de la guía: queda como observación.
 *
 *   DATABASE_URL_TEST="postgresql://postgres:developer@localhost:5432/qa_delivery" \
 *     NINJA_ENV=parentDisabled npx jest --runInBand src/comprobante/delivery-del-pedido.qa
 *
 * La base debe ser DESECHABLE. Nunca la de Railway: es producción.
 */
jest.mock('archiver', () => () => ({ append: () => undefined, finalize: () => undefined, pipe: () => undefined }));

import { PrismaClient } from '@prisma/client';
import { ComprobanteService } from './comprobante.service';
import { GuiaRemisionService } from '../guia-remision/guia-remision.service';

const URL = process.env.DATABASE_URL_TEST;
const describeSiHayBase = URL ? describe : describe.skip;
const prisma = new PrismaClient({ datasources: { db: { url: URL ?? '' } } });
const stub = new Proxy({}, { get: () => async () => ({ id: 1 }) }) as any;

const servicio = new ComprobanteService(prisma as any, stub, stub, stub, stub, stub, stub, stub);
const guias = new GuiaRemisionService(prisma as any, stub, stub);

const PRECIO = 31;
const ENVIO = 15;
let empresaId: number;
let sedeId: number;
let clienteId: number;
let productoId: number;
let usuarioId: number;
let planId: number;
let unidadId: number;
let sello: number;

const crearEscenario = async () => {
  sello = Date.now() + Math.floor(Math.random() * 1000);
  planId = (await prisma.plan.create({ data: { nombre: `QA ${sello}` }, select: { id: true } })).id;
  unidadId = (await prisma.unidadMedida.create({
    data: { codigo: `Q${sello}`.slice(0, 10), nombre: 'Unidad' }, select: { id: true },
  })).id;
  empresaId = (await prisma.empresa.create({
    data: {
      ruc: `20${sello}`.slice(0, 11), razonSocial: `QA DELIVERY ${sello}`, direccion: 'x',
      planId, fechaActivacion: new Date(), fechaExpiracion: new Date(2030, 0, 1),
    }, select: { id: true },
  })).id;
  sedeId = (await prisma.sede.create({ data: { nombre: 'Principal', empresaId }, select: { id: true } })).id;
  usuarioId = (await prisma.usuario.create({
    data: {
      nombre: 'QA', dni: '00000000', celular: '9', email: `qa${sello}@localhost.test`,
      password: 'x', rol: 'ADMIN_EMPRESA', empresaId, sedeId,
    }, select: { id: true },
  })).id;
  clienteId = (await prisma.cliente.create({
    data: { nombre: 'Cliente QA', nroDoc: '71820888', empresaId }, select: { id: true },
  })).id;
  productoId = (await prisma.producto.create({
    data: {
      codigo: `P${sello}`, descripcion: 'Moringa 90 cápsulas', unidadMedidaId: unidadId,
      tipoAfectacionIGV: '10', precioUnitario: PRECIO, valorUnitario: Number((PRECIO / 1.18).toFixed(2)),
      empresaId, stock: 1000,
    }, select: { id: true },
  })).id;
};

const limpiarEscenario = async () => {
  const donde = { comprobante: { empresaId } };
  await prisma.leadPedidoBorrador.deleteMany({ where: { empresaId } });
  await prisma.leadConversacion.deleteMany({ where: { empresaId } });
  await prisma.leyenda.deleteMany({ where: donde });
  await prisma.pago.deleteMany({ where: donde });
  await prisma.detalleComprobante.deleteMany({ where: donde });
  await prisma.comisionVendedor.deleteMany({ where: { empresaId } });
  await prisma.movimientoKardex.deleteMany({ where: { empresaId } });
  await prisma.comprobante.deleteMany({ where: { empresaId } });
  await prisma.producto.deleteMany({ where: { empresaId } });
  await prisma.cliente.deleteMany({ where: { empresaId } });
  await prisma.usuario.deleteMany({ where: { empresaId } });
  await prisma.sede.deleteMany({ where: { empresaId } });
  await prisma.empresa.deleteMany({ where: { id: empresaId } });
  await prisma.plan.deleteMany({ where: { id: planId } });
  await prisma.unidadMedida.deleteMany({ where: { id: unidadId } });
};

const linea = (o: { productoId: number | null; descripcion: string; precio: number }) => ({
  productoId: o.productoId,
  descripcion: o.descripcion,
  cantidad: 1,
  unidad: o.productoId ? 'NIU' : 'ZZ',
  mtoValorUnitario: Number((o.precio / 1.18).toFixed(2)),
  mtoPrecioUnitario: o.precio,
  mtoValorVenta: Number((o.precio / 1.18).toFixed(2)),
  mtoBaseIgv: Number((o.precio / 1.18).toFixed(2)),
  igv: Number((o.precio - o.precio / 1.18).toFixed(2)),
  totalImpuestos: Number((o.precio - o.precio / 1.18).toFixed(2)),
  tipAfeIgv: 10,
  porcentajeIgv: 18,
});

/** Una nota de venta con mercadería + "ENVÍO DELIVERY", como la arma el bot. */
const notaConEnvio = async (opts: { delChat: boolean; descripcionEnvio?: string }) => {
  // Un cliente por caso: dos boletas iguales del mismo cliente en segundos
  // las frena el control de doble envío.
  clienteId = (await prisma.cliente.create({
    data: { nombre: `Cliente QA ${Math.random()}`, nroDoc: '71820888', empresaId }, select: { id: true },
  })).id;
  const total = PRECIO + ENVIO;
  const nv = await prisma.comprobante.create({
    data: {
      tipoDoc: 'NV', serie: 'NV01', correlativo: 1 + Math.floor(Math.random() * 100000),
      fechaEmision: new Date(), formaPagoTipo: 'Contado', formaPagoMoneda: 'PEN', tipoMoneda: 'PEN',
      medioPago: 'YAPE', mtoOperGravadas: Number((total / 1.18).toFixed(2)),
      mtoIGV: Number((total - total / 1.18).toFixed(2)), valorVenta: Number((total / 1.18).toFixed(2)),
      totalImpuestos: Number((total - total / 1.18).toFixed(2)), subTotal: total, mtoImpVenta: total,
      clienteId, empresaId, sedeId, usuarioId, saldo: 0, estadoPago: 'COMPLETADO',
      detalles: {
        create: [
          linea({ productoId, descripcion: 'Moringa 90 cápsulas', precio: PRECIO }),
          linea({ productoId: null, descripcion: opts.descripcionEnvio ?? 'ENVÍO DELIVERY', precio: ENVIO }),
        ],
      },
    },
    select: { id: true },
  });
  await prisma.pago.create({ data: { comprobanteId: nv.id, empresaId, monto: total, medioPago: 'YAPE', usuarioId } });
  if (opts.delChat) {
    const conv = await prisma.leadConversacion.create({
      data: { empresaId, telefonoProspecto: `519${Math.floor(Math.random() * 1e8)}` },
      select: { id: true },
    });
    await prisma.leadPedidoBorrador.create({
      data: { empresaId, conversacionId: conv.id, comprobanteId: nv.id, registradoEn: new Date() },
    });
  }
  return nv.id;
};

/** Convierte la nota a boleta como el panel: manda las mismas líneas de la nota. */
const aBoleta = (origenId: number, descripcionEnvio = 'ENVÍO DELIVERY') =>
  servicio.crearFormal(
    {
      clienteId,
      comprobanteOrigenId: origenId,
      fechaEmision: new Date().toISOString(),
      formaPagoTipo: 'Contado',
      formaPagoMoneda: 'PEN',
      tipoMoneda: 'PEN',
      medioPago: 'Yape',
      observaciones: 'Entregar por la tarde',
      detalles: [
        { productoId, descripcion: 'Moringa 90 cápsulas', cantidad: 1, mtoPrecioUnitario: PRECIO, tipAfeIgv: '10', unidad: 'NIU' },
        { productoId: null, descripcion: descripcionEnvio, cantidad: 1, nuevoValorUnitario: ENVIO, mtoPrecioUnitario: ENVIO, tipAfeIgv: '10', unidad: 'ZZ' },
      ],
    } as any,
    empresaId,
    '03',
    usuarioId,
    sedeId,
  );

const leerBoleta = (id: number) =>
  prisma.comprobante.findUnique({
    where: { id },
    select: { mtoImpVenta: true, observaciones: true, detalles: { select: { descripcion: true } }, pagos: { select: { monto: true } } },
  });

describeSiHayBase('el delivery del pedido del chat no se factura', () => {
  jest.setTimeout(60_000);
  beforeAll(crearEscenario);
  afterAll(async () => {
    await limpiarEscenario();
    await prisma.$disconnect();
  });

  it('la boleta es solo por la mercadería y el delivery queda en observaciones', async () => {
    const nv = await notaConEnvio({ delChat: true });
    const boleta = (await aBoleta(nv)) as any;
    const b = await leerBoleta(boleta.id);
    expect(Number(b!.mtoImpVenta)).toBe(PRECIO);
    expect(b!.detalles.map((d) => d.descripcion)).toEqual(['Moringa 90 cápsulas']);
    expect(b!.observaciones).toContain('Entregar por la tarde');
    expect(b!.observaciones).toContain('ENVÍO DELIVERY: S/ 15.00 (servicio de delivery, se cobra aparte y no forma parte del total)');
    // La nota se cobró entera (46): la boleta no vuelve a cobrar nada.
    expect(b!.pagos).toHaveLength(0);
  });

  it('también el envío a agencia', async () => {
    const nv = await notaConEnvio({ delChat: true, descripcionEnvio: 'ENVÍO AREQUIPA (AGENCIA)' });
    const b = await leerBoleta(((await aBoleta(nv, 'ENVÍO AREQUIPA (AGENCIA)')) as any).id);
    expect(Number(b!.mtoImpVenta)).toBe(PRECIO);
    expect(b!.observaciones).toContain('ENVÍO AREQUIPA (AGENCIA): S/ 15.00');
  });

  it('una nota hecha a mano en el POS con una línea "ENVÍO" se factura como siempre', async () => {
    const nv = await notaConEnvio({ delChat: false });
    const b = await leerBoleta(((await aBoleta(nv)) as any).id);
    expect(Number(b!.mtoImpVenta)).toBe(PRECIO + ENVIO);
    expect(b!.detalles).toHaveLength(2);
  });

  it('la guía de remisión desde la nota del bot no lleva el delivery', async () => {
    const nv = await notaConEnvio({ delChat: true });
    const prefill = await guias.getPrefillDesdeComprobante(nv, empresaId);
    expect(prefill.detalles.map((d: any) => d.descripcion)).toEqual(['Moringa 90 cápsulas']);
    expect(prefill.observaciones).toContain('ENVÍO DELIVERY: S/ 15.00');

    const aMano = await notaConEnvio({ delChat: false });
    const prefillAMano = await guias.getPrefillDesdeComprobante(aMano, empresaId);
    expect(prefillAMano.detalles).toHaveLength(2);
  });
});
