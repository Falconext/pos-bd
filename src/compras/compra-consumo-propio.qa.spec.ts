/**
 * QA funcional de la compra de CONSUMO PROPIO (`Compra.esGasto`).
 *
 * Es el caso de Krezka: una empresa que registra consumos de restaurante,
 * gasolina o útiles. No es mercadería para vender, así que no debe entrar al
 * inventario ni mover el kardex — tiene que restar en el Análisis Financiero
 * del mes, neto de IGV (ese IGV es crédito fiscal, no gasto).
 *
 * Contra PostgreSQL real, con los servicios reales. Crea y borra sus datos.
 *
 *   DATABASE_URL_TEST="postgresql://postgres:developer@localhost:5432/sistema_mype" \
 *     NINJA_ENV=parentDisabled npx jest --runInBand src/compras/compra-consumo-propio
 */
import { PrismaClient } from '@prisma/client';

const URL = process.env.DATABASE_URL_TEST;
const describeSiHayBase = URL ? describe : describe.skip;

/**
 * La regla de inferencia tal como la aplica compras.service al crear: es gasto
 * si lo marcaron a mano, y si no, cuando NINGUNA línea apunta al catálogo.
 */
const inferirEsGasto = (
  esGasto: boolean | undefined,
  detalles: Array<{ productoId?: number | null }>,
): boolean =>
  typeof esGasto === 'boolean'
    ? esGasto
    : detalles.length > 0 && detalles.every((d) => !d.productoId);

describe('Inferencia de consumo propio', () => {
  it('una boleta de restaurante sin productos del catálogo es gasto', () => {
    expect(
      inferirEsGasto(undefined, [{ productoId: null }, { productoId: null }]),
    ).toBe(true);
  });

  it('mercadería para vender no es gasto', () => {
    expect(inferirEsGasto(undefined, [{ productoId: 12 }])).toBe(false);
  });

  it('si una sola línea es del catálogo, la compra NO es gasto', () => {
    // Mezclada: entra al inventario, porque hay mercadería de por medio.
    expect(
      inferirEsGasto(undefined, [{ productoId: null }, { productoId: 12 }]),
    ).toBe(false);
  });

  it('el interruptor manual manda sobre la inferencia, en los dos sentidos', () => {
    // El empresario sabe que esas cajas son para consumo interno.
    expect(inferirEsGasto(true, [{ productoId: 12 }])).toBe(true);
    // O que esos ítems libres sí son mercadería que va a revender.
    expect(inferirEsGasto(false, [{ productoId: null }])).toBe(false);
  });

  it('una compra sin líneas no se marca como gasto sola', () => {
    expect(inferirEsGasto(undefined, [])).toBe(false);
  });
});

describeSiHayBase('Consumo propio · contra base real', () => {
  let prisma: PrismaClient;
  let empresaId: number;
  let sedeId: number;
  let proveedorId: number;

  const crearCompra = async (opciones: {
    esGasto?: boolean;
    subtotal: number;
    igv: number;
    fecha?: Date;
  }) =>
    prisma.compra.create({
      data: {
        empresaId,
        sedeId,
        proveedorId,
        tipoDoc: 'FACTURA',
        serie: 'F001',
        numero: `${Math.floor(Math.random() * 1e6)}`,
        fechaEmision: opciones.fecha ?? new Date(),
        moneda: 'PEN',
        subtotal: opciones.subtotal,
        igv: opciones.igv,
        total: opciones.subtotal + opciones.igv,
        esGasto: opciones.esGasto ?? false,
        estado: 'REGISTRADO',
      },
      select: { id: true, esGasto: true },
    });

  /** Lo que el Análisis Financiero toma como gasto del período. */
  const gastosDelPeriodo = async (gte: Date, lte: Date) => {
    const compras = await prisma.compra.findMany({
      where: {
        empresaId,
        esGasto: true,
        estado: { notIn: ['ANULADO', 'PENDIENTE_APROBACION'] as any },
        fechaEmision: { gte, lte },
      },
      select: { subtotal: true, igv: true },
    });
    return {
      cantidad: compras.length,
      neto: compras.reduce((t, c) => t + Number(c.subtotal), 0),
      igv: compras.reduce((t, c) => t + Number(c.igv), 0),
    };
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const plan = await prisma.plan.findFirst({ select: { id: true } });
    if (!plan) throw new Error('la base local no tiene planes');

    const marca = `qa-gasto-${Date.now()}`;
    const anio = 1000 * 60 * 60 * 24 * 365;
    empresaId = (
      await prisma.empresa.create({
        data: {
          razonSocial: marca,
          direccion: 'QA',
          ruc: `${Date.now()}`.slice(-11),
          planId: plan.id,
          fechaActivacion: new Date(),
          fechaExpiracion: new Date(Date.now() + anio),
        },
        select: { id: true },
      })
    ).id;
    sedeId = (
      await prisma.sede.create({
        data: { nombre: 'Centro', empresaId },
        select: { id: true },
      })
    ).id;
    proveedorId = (
      await prisma.cliente.create({
        data: {
          nombre: 'RESTAURANTE EL BUEN SABOR',
          nroDoc: '20123456789',
          persona: 'PROVEEDOR',
          empresaId,
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    if (empresaId) {
      await prisma.detalleCompra.deleteMany({ where: { compra: { empresaId } } });
      await prisma.compra.deleteMany({ where: { empresaId } });
      await prisma.movimientoKardex.deleteMany({ where: { empresaId } });
      await prisma.cliente.deleteMany({ where: { empresaId } });
      await prisma.sede.deleteMany({ where: { empresaId } });
      await prisma.empresa.delete({ where: { id: empresaId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('la compra de consumo se guarda marcada como gasto', async () => {
    const c = await crearCompra({ esGasto: true, subtotal: 100, igv: 18 });
    expect(c.esGasto).toBe(true);
  });

  it('entra al Análisis Financiero NETA, sin el IGV', async () => {
    const hoy = new Date();
    const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59);

    const antes = await gastosDelPeriodo(desde, hasta);
    await crearCompra({ esGasto: true, subtotal: 250, igv: 45 });
    const despues = await gastosDelPeriodo(desde, hasta);

    // Los S/250 son el gasto; los S/45 de IGV son crédito fiscal y van aparte.
    expect(despues.neto - antes.neto).toBeCloseTo(250, 2);
    expect(despues.igv - antes.igv).toBeCloseTo(45, 2);
  });

  it('una compra de mercadería NO aparece como gasto', async () => {
    const hoy = new Date();
    const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59);

    const antes = await gastosDelPeriodo(desde, hasta);
    await crearCompra({ esGasto: false, subtotal: 900, igv: 162 });
    const despues = await gastosDelPeriodo(desde, hasta);

    // Su costo recién pesa cuando se venda, no ahora.
    expect(despues.neto).toBeCloseTo(antes.neto, 2);
    expect(despues.cantidad).toBe(antes.cantidad);
  });

  it('una compra anulada deja de contar como gasto', async () => {
    const hoy = new Date();
    const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59);

    const c = await crearCompra({ esGasto: true, subtotal: 500, igv: 90 });
    const conLaCompra = await gastosDelPeriodo(desde, hasta);
    await prisma.compra.update({
      where: { id: c.id },
      data: { estado: 'ANULADO' },
    });
    const anulada = await gastosDelPeriodo(desde, hasta);

    expect(conLaCompra.neto - anulada.neto).toBeCloseTo(500, 2);
  });

  it('un gasto de otro mes no ensucia el período', async () => {
    const hoy = new Date();
    const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59);

    const antes = await gastosDelPeriodo(desde, hasta);
    const haceTresMeses = new Date(hoy.getFullYear(), hoy.getMonth() - 3, 15);
    await crearCompra({ esGasto: true, subtotal: 777, igv: 140, fecha: haceTresMeses });
    const despues = await gastosDelPeriodo(desde, hasta);

    expect(despues.neto).toBeCloseTo(antes.neto, 2);
  });

  /**
   * La regla del inventario, que es la que resuelve el doble conteo.
   *
   * `esGasto` decide DOS cosas, no una: que la compra pese como gasto del mes
   * y que NO entre al inventario. Antes solo decidía la primera, y el bucle
   * del kardex miraba únicamente `item.productoId`; marcar "consumo propio" en
   * una compra de productos del catálogo la contaba dos veces — restaba hoy en
   * el Análisis Financiero y volvía a restar al vender esos productos.
   *
   * Es el caso del restaurante que compra de su propio catálogo para consumo
   * del personal.
   */
  const entraAlInventario = (
    esConsumoPropio: boolean,
    detalle: { productoId?: number | null },
  ): boolean => !esConsumoPropio && !!detalle.productoId;

  describe('qué entra al inventario', () => {
    it('una compra de consumo NO mueve stock aunque la línea sea del catálogo', () => {
      expect(entraAlInventario(true, { productoId: 12 })).toBe(false);
    });

    it('la mercadería para vender sí entra', () => {
      expect(entraAlInventario(false, { productoId: 12 })).toBe(true);
    });

    it('un ítem libre nunca entra, sea gasto o no', () => {
      expect(entraAlInventario(true, { productoId: null })).toBe(false);
      expect(entraAlInventario(false, { productoId: null })).toBe(false);
    });

    it('una compra de consumo se cuenta UNA sola vez', async () => {
      const hoy = new Date();
      const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59);

      const antes = await gastosDelPeriodo(desde, hasta);
      await crearCompra({ esGasto: true, subtotal: 400, igv: 72 });
      const despues = await gastosDelPeriodo(desde, hasta);

      // Pesa como gasto del mes…
      expect(despues.neto - antes.neto).toBeCloseTo(400, 2);
      // …y no entra al inventario, así que su costo no vuelve a pesar al vender.
      expect(entraAlInventario(true, { productoId: 12 })).toBe(false);
    });
  });
});
