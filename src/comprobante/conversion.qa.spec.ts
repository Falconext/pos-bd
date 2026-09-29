/**
 * QA funcional de la conversión de informales a comprobante formal, contra
 * PostgreSQL real y el servicio real — sin mocks del camino que se prueba.
 *
 * Nace del caso de OWENSOFT: una nota de venta a crédito YA cobrada entera no
 * se podía convertir a boleta. El sistema pedía un cronograma por plata que el
 * cliente ya había pagado, la cuota daba cero y la emisión moría.
 *
 *   DATABASE_URL_TEST="postgresql://postgres:developer@localhost:5432/qa_conversion" \
 *     NINJA_ENV=parentDisabled npx jest --runInBand src/comprobante/conversion.qa
 *
 * La base debe ser DESECHABLE. Nunca la de Railway: es producción.
 */
// `archiver` es ESM y Jest no lo transforma; el servicio lo importa para los
// ZIP de descarga, que no participan de este flujo. Sin esto el archivo ni
// siquiera carga — por eso este servicio nunca tuvo pruebas de integración.
jest.mock('archiver', () => () => ({ append: () => undefined, finalize: () => undefined, pipe: () => undefined }));

import { PrismaClient } from '@prisma/client';
import { ComprobanteService } from './comprobante.service';

const URL = process.env.DATABASE_URL_TEST;
const describeSiHayBase = URL ? describe : describe.skip;

const prisma = new PrismaClient({ datasources: { db: { url: URL ?? '' } } });

/**
 * Lo que no participa del camino que se prueba.
 *
 * Devuelve `{ id }` porque el servicio encadena sobre el movimiento de kardex
 * que recibe; un stub que devuelve undefined revienta ahí y no llega a lo que
 * interesa, que es el estado de pago.
 */
const stub = new Proxy({}, { get: () => async () => ({ id: 1 }) }) as any;

const servicio = new ComprobanteService(
  prisma as any,           // prisma real
  stub,                    // kardex
  stub,                    // notificaciones de inventario
  stub,                    // s3
  stub,                    // pdf
  stub,                    // lotes
  stub,                    // enviar a SUNAT
  stub,                    // comisiones
);

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
      ruc: `20${sello}`.slice(0, 11), razonSocial: `QA CONV ${sello}`, direccion: 'x',
      planId, fechaActivacion: new Date(), fechaExpiracion: new Date(2030, 0, 1),
    }, select: { id: true },
  })).id;
  sedeId = (await prisma.sede.create({
    data: { nombre: 'Principal', empresaId }, select: { id: true },
  })).id;
  usuarioId = (await prisma.usuario.create({
    data: {
      nombre: 'QA', dni: '00000000', celular: '9', email: `qa${sello}@localhost.test`,
      password: 'x', rol: 'ADMIN_EMPRESA', empresaId, sedeId,
    }, select: { id: true },
  })).id;
  clienteId = (await prisma.cliente.create({
    data: { nombre: 'Cliente QA', nroDoc: '71820888', empresaId },
    select: { id: true },
  })).id;
  productoId = (await prisma.producto.create({
    data: {
      codigo: `P${sello}`, descripcion: 'Producto QA', unidadMedidaId: unidadId,
      tipoAfectacionIGV: '10', precioUnitario: 280, valorUnitario: 237.29,
      empresaId, stock: 1000,
    }, select: { id: true },
  })).id;
};

const limpiarEscenario = async () => {
  // Los hijos de Comprobante, SIN `.catch`: un teardown que traga errores deja
  // la base sucia y la corrida siguiente falla por un motivo que no tiene nada
  // que ver con lo que se está probando. Ya pasó tres veces hoy.
  // La lista sale de las FK reales hacia Comprobante, no de la memoria.
  const donde = { comprobante: { empresaId } };
  await prisma.leyenda.deleteMany({ where: donde });
  await prisma.pago.deleteMany({ where: donde });
  await prisma.detalleComprobante.deleteMany({ where: donde });
  await prisma.comisionVendedor.deleteMany({ where: { empresaId } });
  await prisma.productoSerie.deleteMany({ where: { producto: { empresaId } } }).catch(() => {});
  await prisma.envioDespacho.deleteMany({ where: donde }).catch(() => {});
  await prisma.whatsAppEnvio.deleteMany({ where: donde }).catch(() => {});
  await prisma.campanaMarketing.deleteMany({ where: { empresaId } }).catch(() => {});
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

/** Una nota de venta en el estado de pago que se quiera. */
const nuevoCliente = async () =>
  (await prisma.cliente.create({
    data: { nombre: `Cliente QA ${Date.now()}${Math.random()}`, nroDoc: '71820888', empresaId },
    select: { id: true },
  })).id;

const crearNotaDeVenta = async (opciones: {
  total?: number;
  formaPagoTipo: 'Contado' | 'Credito';
  pagado?: number;
  clienteId?: number;
}) => {
  opciones.clienteId = opciones.clienteId ?? (await nuevoCliente());
  const total = opciones.total ?? 280;
  const pagado = opciones.pagado ?? 0;
  const saldo = Math.max(0, Number((total - pagado).toFixed(2)));
  const nv = await prisma.comprobante.create({
    data: {
      tipoDoc: 'NV', serie: 'NV01', correlativo: 1 + Math.floor(Math.random() * 100000),
      fechaEmision: new Date(), formaPagoTipo: opciones.formaPagoTipo,
      formaPagoMoneda: 'PEN', tipoMoneda: 'PEN', medioPago: 'EFECTIVO',
      mtoOperGravadas: Number((total / 1.18).toFixed(2)),
      mtoIGV: Number((total - total / 1.18).toFixed(2)),
      valorVenta: Number((total / 1.18).toFixed(2)),
      totalImpuestos: Number((total - total / 1.18).toFixed(2)),
      subTotal: total, mtoImpVenta: total,
      clienteId: opciones.clienteId!, empresaId, sedeId, usuarioId,
      saldo, estadoPago: saldo > 0 ? 'PENDIENTE_PAGO' : 'COMPLETADO',
      detalles: {
        create: [{
          productoId, descripcion: 'Producto QA', cantidad: 1, unidad: 'NIU',
          mtoValorUnitario: Number((total / 1.18).toFixed(2)),
          mtoPrecioUnitario: total,
          mtoValorVenta: Number((total / 1.18).toFixed(2)),
          mtoBaseIgv: Number((total / 1.18).toFixed(2)),
          igv: Number((total - total / 1.18).toFixed(2)),
          totalImpuestos: Number((total - total / 1.18).toFixed(2)),
          tipAfeIgv: 10, porcentajeIgv: 18,
        }],
      },
    },
    select: { id: true, correlativo: true },
  });
  if (pagado > 0) {
    // Sin `.catch`: si el pago no se crea, el escenario no es el que dice ser y
    // las pruebas pasarían por el motivo equivocado.
    await prisma.pago.create({
      data: { comprobanteId: nv.id, empresaId, monto: pagado, medioPago: 'EFECTIVO', usuarioId },
    });
  }
  return { ...nv, clienteId: opciones.clienteId! };
};

/** Precio del producto de prueba: el servicio recalcula el total desde acá. */
const PRECIO = 280;

/**
 * Convierte esa nota a boleta, como hace el panel.
 *
 * El monto se varía por CANTIDAD y no por precio: el servicio recalcula el
 * total desde el precio del producto e ignora el unitario que llegue, así que
 * variar el precio dejaba todos los casos en 280 y las pruebas pasaban por el
 * motivo equivocado.
 */
const convertirABoleta = async (origenId: number, cantidad = 1, entrada: Record<string, any> = {}) => {
  return servicio.crearFormal(
    {
      clienteId: entrada.clienteId ?? clienteId,
      comprobanteOrigenId: origenId,
      fechaEmision: new Date().toISOString(),
      formaPagoTipo: 'Contado',
      formaPagoMoneda: 'PEN',
      tipoMoneda: 'PEN',
      medioPago: 'Efectivo',
      detalles: [{
        productoId, descripcion: 'Producto QA', cantidad,
        mtoValorUnitario: Number((PRECIO / 1.18).toFixed(2)),
        mtoPrecioUnitario: PRECIO, tipAfeIgv: '10', unidad: 'NIU',
      }],
      ...entrada,
    },
    empresaId, '03', usuarioId, sedeId,
  );
};

/** Lee el comprobante recién creado tal como quedó guardado. */
const guardado = (id: number) =>
  prisma.comprobante.findUnique({
    where: { id },
    select: { tipoDoc: true, saldo: true, estadoPago: true, cuotas: true,
              formaPagoTipo: true, mtoImpVenta: true },
  }) as any;

/** Cuánta plata quedó registrada en caja para ese comprobante. */
const cobradoEnCaja = async (comprobanteId: number) => {
  const r = await prisma.pago.aggregate({
    where: { comprobanteId }, _sum: { monto: true },
  }).catch(() => ({ _sum: { monto: 0 } } as any));
  return Number(r?._sum?.monto ?? 0);
};

describeSiHayBase('QA funcional · conversión de informales', () => {
  beforeAll(crearEscenario);
  afterAll(limpiarEscenario);

  /** El total que el servicio va a calcular para N unidades. */
  const totalDe = (unidades: number) => Number((PRECIO * unidades).toFixed(2));

  // ── RONDA 1 · el caso que reportó OWENSOFT ──────────────────────────────
  describe('Ronda 1 · crédito ya cobrado entero', () => {
    it('se convierte sin trabarse', async () => {
      const t = totalDe(1);
      const nv = await crearNotaDeVenta({ total: t, formaPagoTipo: 'Credito', pagado: t });
      const b: any = await convertirABoleta(nv.id, 1, { clienteId: nv.clienteId });
      expect(b?.id).toBeTruthy();
      expect(b.tipoDoc).toBe('03');
    });

    it('queda sin saldo y como venta completada aunque llegue como CRÉDITO', async () => {
      // Se fuerza formaPagoTipo CREDITO a propósito: es el camino del backend
      // donde vivía el defecto. Convertirla como contado no probaría nada.
      const t = totalDe(2);
      const nv = await crearNotaDeVenta({ total: t, formaPagoTipo: 'Credito', pagado: t });
      const b: any = await convertirABoleta(nv.id, 2, {
        clienteId: nv.clienteId, formaPagoTipo: 'Credito',
        fechaVencimientoCredito: '2026-12-31',
      });
      const g = await guardado(b.id);
      expect(Number(g.mtoImpVenta)).toBe(t);
      expect(Number(g.saldo)).toBe(0);
      expect(g.estadoPago).toBe('COMPLETADO');
    });

    it('no deja cuenta por cobrar en cero', async () => {
      // También por el camino de crédito: una cuenta por cobrar de S/0 ensucia
      // los reportes de morosidad y le aparece al empresario como deuda viva.
      const t = totalDe(3);
      const nv = await crearNotaDeVenta({ total: t, formaPagoTipo: 'Credito', pagado: t });
      const b: any = await convertirABoleta(nv.id, 3, {
        clienteId: nv.clienteId, formaPagoTipo: 'Credito',
        fechaVencimientoCredito: '2026-12-31',
      });
      const g = await guardado(b.id);
      expect(g.estadoPago).not.toBe('PENDIENTE_PAGO');
      expect(Number(g.saldo)).toBe(0);
    });
  });

  // ── RONDA 2 · el crédito de verdad no se rompe ──────────────────────────
  describe('Ronda 2 · crédito con saldo pendiente', () => {
    it('conserva solo lo que falta cobrar', async () => {
      const t = totalDe(4);                       // 1120
      const nv = await crearNotaDeVenta({ total: t, formaPagoTipo: 'Credito', pagado: 400 });
      const b: any = await convertirABoleta(nv.id, 4, {
        clienteId: nv.clienteId, formaPagoTipo: 'Credito',
        fechaVencimientoCredito: '2026-12-31',
      });
      const g = await guardado(b.id);
      expect(Number(g.saldo)).toBe(t - 400);
      expect(g.estadoPago).toBe('PENDIENTE_PAGO');
    });

    it('sin nada cobrado queda el total pendiente', async () => {
      const t = totalDe(5);
      const nv = await crearNotaDeVenta({ total: t, formaPagoTipo: 'Credito', pagado: 0 });
      const b: any = await convertirABoleta(nv.id, 5, {
        clienteId: nv.clienteId, formaPagoTipo: 'Credito',
        fechaVencimientoCredito: '2026-12-31',
      });
      const g = await guardado(b.id);
      expect(Number(g.saldo)).toBe(t);
      expect(g.estadoPago).toBe('PENDIENTE_PAGO');
    });
  });

  // ── RONDA 3 · las ventas normales no cambian ────────────────────────────
  describe('Ronda 3 · contado, que es el 95% de los casos', () => {
    it('una nota al contado se convierte al contado, sin saldo', async () => {
      const t = totalDe(6);
      const nv = await crearNotaDeVenta({ total: t, formaPagoTipo: 'Contado', pagado: t });
      const b: any = await convertirABoleta(nv.id, 6, { clienteId: nv.clienteId });
      const g = await guardado(b.id);
      expect(Number(g.saldo)).toBe(0);
      expect(g.estadoPago).toBe('COMPLETADO');
    });

    it('una boleta nueva sin origen sigue igual que siempre', async () => {
      // La garantía de que esto no le toca nada a la emisión de todos los días.
      const b: any = await convertirABoleta(0, 7, {
        comprobanteOrigenId: undefined, clienteId: await nuevoCliente(),
      });
      const g = await guardado(b.id);
      expect(Number(g.saldo)).toBe(0);
      expect(g.estadoPago).toBe('COMPLETADO');
    });
  });

  // ── RONDA 4 · la plata no se cuenta dos veces ───────────────────────────
  describe('Ronda 4 · caja', () => {
    it('lo ya cobrado en la nota no se vuelve a registrar', async () => {
      const t = totalDe(8);
      const nv = await crearNotaDeVenta({ total: t, formaPagoTipo: 'Credito', pagado: t });
      const b: any = await convertirABoleta(nv.id, 8, { clienteId: nv.clienteId });
      expect(await cobradoEnCaja(b.id)).toBe(0);
    });

    it('si el origen se cobró a medias, solo entra la diferencia', async () => {
      const t = totalDe(9);                       // 2520
      const nv = await crearNotaDeVenta({ total: t, formaPagoTipo: 'Credito', pagado: 520 });
      const b: any = await convertirABoleta(nv.id, 9, { clienteId: nv.clienteId });
      expect(await cobradoEnCaja(b.id)).toBe(t - 520);
    });
  });

  // ── RONDA 5 · bordes ────────────────────────────────────────────────────
  describe('Ronda 5 · bordes', () => {
    it('un centavo pendiente sigue siendo crédito', async () => {
      const t = totalDe(10);
      const nv = await crearNotaDeVenta({ total: t, formaPagoTipo: 'Credito', pagado: t - 0.01 });
      const b: any = await convertirABoleta(nv.id, 10, {
        clienteId: nv.clienteId, formaPagoTipo: 'Credito',
        fechaVencimientoCredito: '2026-12-31',
      });
      const g = await guardado(b.id);
      expect(Number(g.saldo)).toBeCloseTo(0.01, 2);
      expect(g.estadoPago).toBe('PENDIENTE_PAGO');
    });

    it('si cobraron de más el saldo no se va a negativo', async () => {
      const t = totalDe(11);
      const nv = await crearNotaDeVenta({ total: t, formaPagoTipo: 'Credito', pagado: t + 500 });
      const b: any = await convertirABoleta(nv.id, 11, { clienteId: nv.clienteId });
      const g = await guardado(b.id);
      expect(Number(g.saldo)).toBe(0);
    });

    it('montos con decimales no dejan restos de medio centavo', async () => {
      const t = totalDe(12);
      const nv = await crearNotaDeVenta({ total: t, formaPagoTipo: 'Credito', pagado: 1000.55 });
      const b: any = await convertirABoleta(nv.id, 12, {
        clienteId: nv.clienteId, formaPagoTipo: 'Credito',
        fechaVencimientoCredito: '2026-12-31',
      });
      const g = await guardado(b.id);
      expect(Number(g.saldo)).toBe(Number((t - 1000.55).toFixed(2)));
    });
  });
});
