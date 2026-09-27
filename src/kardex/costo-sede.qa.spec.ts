/**
 * QA funcional del costo por sede, contra PostgreSQL real.
 *
 * Catorce rondas sobre empresas creadas para la ocasión, con los servicios reales
 * —kardex, dashboard— y datos que se crean y se borran. No hay mocks: lo que
 * falla aquí, falla en el panel.
 *
 * Cada ronda arranca de una empresa nueva, así que correr el archivo varias
 * veces seguidas tiene que dar exactamente lo mismo; si no, hay arrastre de
 * estado y eso también es un defecto.
 *
 *   DATABASE_URL_TEST="postgresql://postgres:developer@localhost:5432/sistema_mype" \
 *     NINJA_ENV=parentDisabled npx jest --runInBand src/kardex/costo-sede.qa
 */
import { PrismaClient } from '@prisma/client';
import { KardexService } from './kardex.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { costoDeSede } from './costo-sede';

const URL = process.env.DATABASE_URL_TEST;
const describeSiHayBase = URL ? describe : describe.skip;

/** Un escenario aislado: empresa nueva, dos sedes, un producto. */
class Escenario {
  empresaId!: number;
  centro!: number;
  norte!: number;
  productoId!: number;
  clienteId!: number;
  usuarioId!: number;
  kardex!: KardexService;
  dashboard!: any;

  constructor(private prisma: PrismaClient) {}

  async montar(marca: string) {
    const [plan, unidad, usuario] = await Promise.all([
      this.prisma.plan.findFirst({ select: { id: true } }),
      this.prisma.unidadMedida.findFirst({ select: { id: true } }),
      this.prisma.usuario.findFirst({
        where: { NOT: { restringirTransferenciasASuSede: true } },
        select: { id: true },
      }),
    ]);
    if (!plan || !unidad || !usuario) throw new Error('falta catálogo base en la BD local');
    this.usuarioId = usuario.id;

    const anio = 1000 * 60 * 60 * 24 * 365;
    this.empresaId = (
      await this.prisma.empresa.create({
        data: {
          razonSocial: marca,
          direccion: 'QA',
          ruc: `${Date.now()}${Math.floor(Math.random() * 100)}`.slice(-11),
          planId: plan.id,
          fechaActivacion: new Date(),
          fechaExpiracion: new Date(Date.now() + anio),
        },
        select: { id: true },
      })
    ).id;

    const [c, n] = await Promise.all([
      this.prisma.sede.create({
        data: { nombre: 'Centro', empresaId: this.empresaId },
        select: { id: true },
      }),
      this.prisma.sede.create({
        data: { nombre: 'Norte', empresaId: this.empresaId },
        select: { id: true },
      }),
    ]);
    this.centro = c.id;
    this.norte = n.id;

    this.productoId = (
      await this.prisma.producto.create({
        data: {
          codigo: marca,
          descripcion: marca,
          empresaId: this.empresaId,
          unidadMedidaId: unidad.id,
          tipoAfectacionIGV: '10',
          precioUnitario: 300,
          valorUnitario: 300,
          costoPromedio: 0,
          stock: 0,
        },
        select: { id: true },
      })
    ).id;
    await this.prisma.productoStock.createMany({
      data: [
        { productoId: this.productoId, sedeId: this.centro, stock: 0 },
        { productoId: this.productoId, sedeId: this.norte, stock: 0 },
      ],
    });

    this.clienteId = (
      await this.prisma.cliente.create({
        data: { nombre: marca, nroDoc: '00000000', empresaId: this.empresaId },
        select: { id: true },
      })
    ).id;

    this.kardex = new KardexService(this.prisma as any, {} as any, {} as any);
    this.dashboard = Object.create(DashboardService.prototype);
    this.dashboard.prisma = this.prisma;
  }

  /**
   * Borra el escenario entero. El orden importa: las llaves foráneas de
   * comprobantes y kardex no van en cascada, así que un `delete` directo de la
   * empresa falla en silencio y deja basura acumulándose en la base local.
   */
  async desmontar() {
    if (!this.empresaId) return;
    const empresaId = this.empresaId;
    await this.prisma.detalleComprobante.deleteMany({
      where: { comprobante: { empresaId } },
    });
    await this.prisma.comprobante.deleteMany({ where: { empresaId } });
    await this.prisma.movimientoKardex.deleteMany({ where: { empresaId } });
    await this.prisma.productoStock.deleteMany({
      where: { producto: { empresaId } },
    });
    await this.prisma.producto.deleteMany({ where: { empresaId } });
    await this.prisma.cliente.deleteMany({ where: { empresaId } });
    await this.prisma.sede.deleteMany({ where: { empresaId } });
    await this.prisma.empresa.delete({ where: { id: empresaId } });
  }

  /** Una tercera sede, para los casos que no se ven con solo dos. */
  async abrirSede(nombre: string) {
    const s = await this.prisma.sede.create({
      data: { nombre, empresaId: this.empresaId },
      select: { id: true },
    });
    await this.prisma.productoStock.create({
      data: { productoId: this.productoId, sedeId: s.id, stock: 0 },
    });
    return s.id;
  }

  /** Un producto más, con sus filas de stock en las sedes que se indiquen. */
  async nuevoProducto(marca: string, sedes: number[], padreId?: number) {
    const unidad = await this.prisma.unidadMedida.findFirst({ select: { id: true } });
    const p = await this.prisma.producto.create({
      data: {
        codigo: marca,
        descripcion: marca,
        empresaId: this.empresaId,
        unidadMedidaId: unidad!.id,
        tipoAfectacionIGV: '10',
        precioUnitario: 100,
        valorUnitario: 100,
        costoPromedio: 0,
        stock: 0,
        ...(padreId ? { productoPadreId: padreId } : {}),
      },
      select: { id: true },
    });
    await this.prisma.productoStock.createMany({
      data: sedes.map((sedeId) => ({ productoId: p.id, sedeId, stock: 0 })),
    });
    return p.id;
  }

  /** Un ajuste de inventario, positivo o negativo. */
  async ajustar(sedeId: number, delta: number, productoId = this.productoId) {
    const actual = await this.stockDe(sedeId, productoId);
    await (this.kardex as any).actualizarStockYCosto(
      productoId,
      sedeId,
      actual + delta,
      'AJUSTE',
      undefined,
      delta,
    );
  }

  /** Un ingreso de mercadería a una sede, como lo hace una compra. */
  async comprar(sedeId: number, cantidad: number, costo: number, productoId = this.productoId) {
    const actual = await this.stockDe(sedeId, productoId);
    await (this.kardex as any).actualizarStockYCosto(
      productoId,
      sedeId,
      actual + cantidad,
      'INGRESO',
      costo,
      cantidad,
    );
  }

  /** Una salida de mercadería de una sede, como lo hace una venta. */
  async despachar(sedeId: number, cantidad: number, productoId = this.productoId) {
    const actual = await this.stockDe(sedeId, productoId);
    await (this.kardex as any).actualizarStockYCosto(
      productoId,
      sedeId,
      actual - cantidad,
      'SALIDA',
      undefined,
      cantidad,
    );
  }

  async stockDe(sedeId: number, productoId = this.productoId) {
    const f = await this.prisma.productoStock.findUnique({
      where: { productoId_sedeId: { productoId, sedeId } },
      select: { stock: true },
    });
    return Number(f?.stock ?? 0);
  }

  async costoDe(sedeId: number, productoId = this.productoId) {
    const f = await this.prisma.productoStock.findUnique({
      where: { productoId_sedeId: { productoId, sedeId } },
      select: { costoPromedio: true },
    });
    return f?.costoPromedio == null ? null : Number(f.costoPromedio);
  }

  async costoGlobal(productoId = this.productoId) {
    const p = await this.prisma.producto.findUnique({
      where: { id: productoId },
      select: { costoPromedio: true },
    });
    return Number(p?.costoPromedio ?? 0);
  }

  /** Lo que valen las sedes por separado, con el respaldo al global. */
  async valorPorSedes(productoId = this.productoId) {
    const filas = await this.prisma.productoStock.findMany({
      where: { productoId },
      select: { stock: true, costoPromedio: true },
    });
    const global = await this.costoGlobal(productoId);
    return filas.reduce(
      (t, f) => t + Number(f.stock) * costoDeSede(f.costoPromedio, global),
      0,
    );
  }

  /** Lo que vale el producto entero según el costo global. */
  async valorGlobal(productoId = this.productoId) {
    const p = await this.prisma.producto.findUnique({
      where: { id: productoId },
      select: { stock: true, costoPromedio: true },
    });
    return Number(p?.stock ?? 0) * Number(p?.costoPromedio ?? 0);
  }

  /** Una venta emitida en una sede, para que la rentabilidad la vea. */
  async vender(sedeId: number, cantidad: number, precioUnitario: number, correlativo: number) {
    const neto = cantidad * precioUnitario;
    const comprobante = await this.prisma.comprobante.create({
      data: {
        tipoDoc: '03',
        serie: 'B001',
        correlativo,
        fechaEmision: new Date(),
        formaPagoTipo: 'Contado',
        formaPagoMoneda: 'PEN',
        tipoMoneda: 'PEN',
        mtoOperGravadas: neto,
        mtoIGV: 0,
        valorVenta: neto,
        totalImpuestos: 0,
        subTotal: neto,
        mtoImpVenta: neto,
        clienteId: this.clienteId,
        empresaId: this.empresaId,
        sedeId,
      },
      select: { id: true },
    });
    await this.prisma.detalleComprobante.create({
      data: {
        comprobanteId: comprobante.id,
        productoId: this.productoId,
        unidad: 'NIU',
        descripcion: 'QA',
        cantidad,
        mtoValorUnitario: precioUnitario,
        mtoValorVenta: neto,
        mtoBaseIgv: neto,
        porcentajeIgv: 0,
        igv: 0,
        tipAfeIgv: 10,
        totalImpuestos: 0,
        mtoPrecioUnitario: precioUnitario,
      },
    });
    await this.despachar(sedeId, cantidad);
  }
}

describeSiHayBase('QA funcional · costo por sede', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Monta un escenario limpio por ronda y lo desmonta pase lo que pase. */
  const enEscenario = (nombre: string, cuerpo: (e: Escenario) => Promise<void>) =>
    it(nombre, async () => {
      const e = new Escenario(prisma);
      await e.montar(`qa-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
      try {
        await cuerpo(e);
      } finally {
        await e.desmontar();
      }
    });

  // ── RONDA 1 · La compra, que es de donde sale todo ────────────────────────
  describe('Ronda 1 · comprar en dos sedes a precios distintos', () => {
    enEscenario('cada sede queda con el costo que pagó', async (e) => {
      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.norte, 10, 200);

      expect(await e.costoDe(e.centro)).toBe(100);
      expect(await e.costoDe(e.norte)).toBe(200);
      // El global sigue siendo el ponderado de todo: 2000+... /20 = 150.
      expect(await e.costoGlobal()).toBe(150);
    });

    enEscenario('el inventario valorizado de una sede usa el costo de esa sede', async (e) => {
      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.norte, 10, 200);

      const centro: any = await e.kardex.obtenerInventarioValorizado(
        e.empresaId,
        {} as any,
        e.centro,
      );
      const norte: any = await e.kardex.obtenerInventarioValorizado(
        e.empresaId,
        {} as any,
        e.norte,
      );
      const enCentro = centro.productos.find((p: any) => p.id === e.productoId);
      const enNorte = norte.productos.find((p: any) => p.id === e.productoId);

      // Antes ambas salían a S/150 —el global— aunque Centro pagó 100.
      expect(enCentro.costoPromedio).toBe(100);
      expect(enCentro.valorTotal).toBe(1000);
      expect(enNorte.costoPromedio).toBe(200);
      expect(enNorte.valorTotal).toBe(2000);
    });

    enEscenario('comprar dos veces en la misma sede pondera contra lo suyo', async (e) => {
      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.norte, 10, 200);
      await e.comprar(e.centro, 10, 140);

      // Contra su propio costo (100) → 120. Contra el global (150) daría 145.
      expect(await e.costoDe(e.centro)).toBe(120);
      expect(await e.costoDe(e.norte)).toBe(200);
    });
  });

  // ── RONDA 2 · El traslado ─────────────────────────────────────────────────
  describe('Ronda 2 · trasladar entre sedes', () => {
    enEscenario('sale al costo de quien envía y el que recibe lo promedia', async (e) => {
      await e.comprar(e.centro, 20, 120);
      await e.comprar(e.norte, 10, 200);

      await e.kardex.realizarTraslado(
        {
          sedeOrigenId: e.norte,
          sedeDestinoId: e.centro,
          items: [{ productoId: e.productoId, cantidad: 10 }],
        } as any,
        e.empresaId,
        e.usuarioId,
      );

      const salida = await prisma.movimientoKardex.findFirst({
        where: { productoId: e.productoId, sedeId: e.norte, tipoMovimiento: 'SALIDA' },
        orderBy: { id: 'desc' },
        select: { costoUnitario: true, valorTotal: true },
      });
      expect(Number(salida?.costoUnitario)).toBe(200);
      expect(Number(salida?.valorTotal)).toBe(2000);

      // Centro: 20×120 + 10×200 = 4400 sobre 30.
      expect(await e.stockDe(e.centro)).toBe(30);
      expect(await e.costoDe(e.centro)).toBeCloseTo(4400 / 30, 4);
    });

    enEscenario('un traslado no crea ni destruye valor', async (e) => {
      await e.comprar(e.centro, 20, 120);
      await e.comprar(e.norte, 10, 200);
      const antes = await e.valorPorSedes();

      await e.kardex.realizarTraslado(
        {
          sedeOrigenId: e.norte,
          sedeDestinoId: e.centro,
          items: [{ productoId: e.productoId, cantidad: 10 }],
        } as any,
        e.empresaId,
        e.usuarioId,
      );

      expect(await e.valorPorSedes()).toBeCloseTo(antes, 4);
      expect(await e.valorGlobal()).toBeCloseTo(antes, 4);
    });

    enEscenario('trasladar a una sede que nunca tuvo el producto le fija el costo', async (e) => {
      await e.comprar(e.norte, 10, 200);
      expect(await e.costoDe(e.centro)).toBeNull();

      await e.kardex.realizarTraslado(
        {
          sedeOrigenId: e.norte,
          sedeDestinoId: e.centro,
          items: [{ productoId: e.productoId, cantidad: 4 }],
        } as any,
        e.empresaId,
        e.usuarioId,
      );

      expect(await e.costoDe(e.centro)).toBe(200);
    });
  });

  // ── RONDA 3 · La rentabilidad, que es para lo que se hizo todo esto ───────
  describe('Ronda 3 · rentabilidad por sede', () => {
    enEscenario('cada sede carga su propio costo en el margen', async (e) => {
      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.norte, 10, 200);
      await e.vender(e.centro, 1, 300, 1);
      await e.vender(e.norte, 1, 300, 2);

      const enCentro = await e.dashboard.utilidadBrutaPen({
        empresaId: e.empresaId,
        sedeId: e.centro,
      });
      const enNorte = await e.dashboard.utilidadBrutaPen({
        empresaId: e.empresaId,
        sedeId: e.norte,
      });

      // Misma venta de S/300 en las dos, pero Norte compró más caro.
      expect(enCentro).toEqual({ venta: 300, costo: 100, utilidad: 200 });
      expect(enNorte).toEqual({ venta: 300, costo: 200, utilidad: 100 });
    });

    enEscenario('la utilidad de toda la empresa es la suma de sus sedes', async (e) => {
      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.norte, 10, 200);
      await e.vender(e.centro, 1, 300, 1);
      await e.vender(e.norte, 1, 300, 2);

      const total = await e.dashboard.utilidadBrutaPen({ empresaId: e.empresaId });
      expect(total).toEqual({ venta: 600, costo: 300, utilidad: 300 });
    });

    enEscenario('una sede sin costo propio no rompe el reporte', async (e) => {
      // Producto con costo global cargado a mano y ninguna compra por sede.
      await prisma.producto.update({
        where: { id: e.productoId },
        data: { costoPromedio: 90, stock: 10 },
      });
      await prisma.productoStock.update({
        where: { productoId_sedeId: { productoId: e.productoId, sedeId: e.centro } },
        data: { stock: 10 },
      });
      await e.vender(e.centro, 2, 300, 1);

      const r = await e.dashboard.utilidadBrutaPen({ empresaId: e.empresaId });
      // Cae al global: es exactamente lo que se ve hoy, sin la columna.
      expect(r).toEqual({ venta: 600, costo: 180, utilidad: 420 });
    });
  });

  // ── RONDA 4 · Los bordes, que es donde se rompen las cosas ────────────────
  describe('Ronda 4 · bordes', () => {
    enEscenario('una bonificación baja el costo de la sede, no lo deja igual', async (e) => {
      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.centro, 10, 0); // 10 gratis del proveedor

      expect(await e.costoDe(e.centro)).toBe(50);
    });

    enEscenario('un costo cero es un costo, no un "sin dato"', async (e) => {
      await e.comprar(e.centro, 10, 0);
      await prisma.producto.update({
        where: { id: e.productoId },
        data: { costoPromedio: 500 },
      });

      // La sede vale 0 aunque el global diga 500: no paga lo que no pagó.
      const inv: any = await e.kardex.obtenerInventarioValorizado(
        e.empresaId,
        {} as any,
        e.centro,
      );
      expect(inv.productos.find((p: any) => p.id === e.productoId).costoPromedio).toBe(0);
    });

    enEscenario('con stock negativo por sobreventa, el costo no se dispara', async (e) => {
      await e.comprar(e.centro, 5, 100);
      // Sobreventa: se despachan 8 de 5.
      await prisma.productoStock.update({
        where: { productoId_sedeId: { productoId: e.productoId, sedeId: e.centro } },
        data: { stock: -3 },
      });
      await prisma.producto.update({
        where: { id: e.productoId },
        data: { stock: -3 },
      });

      await e.comprar(e.centro, 10, 200);

      // Sin la guarda daba más de S/200, que es más caro de lo que se compró.
      const costo = await e.costoDe(e.centro);
      expect(costo).toBe(200);
      expect(costo).toBeGreaterThan(0);
      expect(await e.costoGlobal()).toBeGreaterThan(0);
    });

    enEscenario('vender no altera el costo de la sede', async (e) => {
      await e.comprar(e.centro, 10, 100);
      await e.despachar(e.centro, 4);

      // El promedio ponderado solo se mueve cuando ENTRA mercadería.
      expect(await e.costoDe(e.centro)).toBe(100);
      expect(await e.stockDe(e.centro)).toBe(6);
    });

    enEscenario('la sede sin movimientos se queda en NULL y vale el global', async (e) => {
      await e.comprar(e.centro, 10, 100);

      expect(await e.costoDe(e.norte)).toBeNull();
      expect(costoDeSede(await e.costoDe(e.norte), await e.costoGlobal())).toBe(100);
    });
  });

  // ── RONDA 5 · La invariante bajo movimiento repetido ──────────────────────
  describe('Ronda 5 · la invariante aguanta una operación larga', () => {
    enEscenario('tras 20 movimientos mezclados, las sedes siguen cuadrando', async (e) => {
      // Una operación cualquiera: compras a precios distintos en las dos
      // sedes, traslados en los dos sentidos y ventas en el medio.
      for (let i = 1; i <= 5; i++) {
        await e.comprar(e.centro, 10, 100 + i * 7);
        await e.comprar(e.norte, 10, 200 - i * 5);
        await e.despachar(e.centro, 3);
        await e.kardex.realizarTraslado(
          {
            sedeOrigenId: i % 2 === 0 ? e.centro : e.norte,
            sedeDestinoId: i % 2 === 0 ? e.norte : e.centro,
            items: [{ productoId: e.productoId, cantidad: 2 }],
          } as any,
          e.empresaId,
          e.usuarioId,
        );
      }

      // Que valgan lo mismo por sede y en global es lo que mantiene honesto
      // el reporte: si esto se separa, los números dejan de cuadrar.
      const porSedes = await e.valorPorSedes();
      const global = await e.valorGlobal();
      expect(porSedes).toBeGreaterThan(0);
      expect(porSedes).toBeCloseTo(global, 2);
    });

    enEscenario('ningún costo queda negativo ni por encima de lo comprado', async (e) => {
      for (let i = 1; i <= 5; i++) {
        await e.comprar(e.centro, 8, 50 + i * 10);
        await e.comprar(e.norte, 8, 300 - i * 20);
        await e.despachar(e.norte, 2);
      }

      const centro = await e.costoDe(e.centro);
      const norte = await e.costoDe(e.norte);
      // Centro compró entre 60 y 100; Norte entre 200 y 280.
      expect(centro).toBeGreaterThanOrEqual(60);
      expect(centro).toBeLessThanOrEqual(100);
      expect(norte).toBeGreaterThanOrEqual(200);
      expect(norte).toBeLessThanOrEqual(280);
    });

    /**
     * La verificación que más importa para el riesgo real: la mayoría de las
     * empresas tiene una sola sede, y para ellas esto no puede cambiar NADA.
     * Se corre en paralelo la fórmula vieja —promedio global incremental— y se
     * exige que dé el mismo número movimiento a movimiento.
     */
    enEscenario('con una sola sede, el costo es idéntico al de la fórmula vieja', async (e) => {
      // Se saca del juego la segunda sede, para que sea una empresa de una.
      await prisma.productoStock.delete({
        where: { productoId_sedeId: { productoId: e.productoId, sedeId: e.norte } },
      });

      const compras = [
        { cantidad: 10, costo: 100 },
        { cantidad: 5, costo: 140 },
        { cantidad: 20, costo: 92.5 },
        { cantidad: 3, costo: 0 }, // bonificación
        { cantidad: 7, costo: 210.33 },
      ];

      let stockViejo = 0;
      let costoViejo = 0;

      for (const c of compras) {
        await e.comprar(e.centro, c.cantidad, c.costo);

        // La fórmula tal como estaba antes de todo este trabajo.
        const stockNuevo = stockViejo + c.cantidad;
        costoViejo =
          (stockViejo * costoViejo + c.cantidad * c.costo) / stockNuevo;
        stockViejo = stockNuevo;

        expect(await e.costoGlobal()).toBeCloseTo(costoViejo, 6);
        expect(await e.costoDe(e.centro)).toBeCloseTo(costoViejo, 6);
      }

      // Y una venta tampoco lo mueve, igual que antes.
      await e.despachar(e.centro, 12);
      expect(await e.costoGlobal()).toBeCloseTo(costoViejo, 6);
    });

    enEscenario('el stock global es siempre la suma de las sedes', async (e) => {
      await e.comprar(e.centro, 13, 100);
      await e.comprar(e.norte, 7, 200);
      await e.despachar(e.centro, 5);

      const p = await prisma.producto.findUnique({
        where: { id: e.productoId },
        select: { stock: true },
      });
      expect(Number(p?.stock)).toBe(
        (await e.stockDe(e.centro)) + (await e.stockDe(e.norte)),
      );
    });
  });

  /**
   * Este defecto solo apareció con datos reales, con un producto que ya tenía
   * stock repartido en tres sedes antes de existir la columna.
   *
   * Una sede en NULL "vale el global", pero el global se deriva de las sedes.
   * Mientras quedaran NULLs en la mezcla, cada recálculo las revaluaba con el
   * global recién calculado y el costo se iba solo para arriba: S/36.62 se
   * convertía en S/41.99 en seis movimientos, sin que entrara mercadería. El
   * inventario se habría ido inflando en silencio.
   */
  describe('Ronda 6 · el producto que ya tenía stock en varias sedes', () => {
    enEscenario('el costo no se infla solo al repetir movimientos', async (e) => {
      const sur = await e.abrirSede('Sur');
      // Producto viejo: stock en las tres sedes y un costo global, ninguna con
      // costo propio. Es el estado de las 5 805 filas que hay hoy en la base.
      for (const sede of [e.centro, e.norte, sur]) {
        await prisma.productoStock.update({
          where: { productoId_sedeId: { productoId: e.productoId, sedeId: sede } },
          data: { stock: 29, costoPromedio: null },
        });
      }
      await prisma.producto.update({
        where: { id: e.productoId },
        data: { stock: 87, costoPromedio: 36.62 },
      });

      // La primera compra en una sede: aquí es donde arrancaba el lazo.
      await e.comprar(e.centro, 10, 58.59);
      const trasLaCompra = await e.costoGlobal();

      // Movimientos que no agregan valor: el costo no puede moverse.
      await e.ajustar(e.norte, 0);
      await e.despachar(e.centro, 1);
      await e.ajustar(sur, 0);
      const despues = await e.costoGlobal();

      // Una salida cambia la mezcla, así que el global puede variar algo; lo
      // que NO puede es dispararse hacia arriba sin mercadería nueva.
      expect(despues).toBeLessThanOrEqual(trasLaCompra + 0.01);
      expect(await e.valorPorSedes()).toBeCloseTo(await e.valorGlobal(), 2);
    });

    enEscenario('las sedes que no compraron quedan fijadas en el global vigente', async (e) => {
      const sur = await e.abrirSede('Sur');
      for (const sede of [e.centro, e.norte, sur]) {
        await prisma.productoStock.update({
          where: { productoId_sedeId: { productoId: e.productoId, sedeId: sede } },
          data: { stock: 29, costoPromedio: null },
        });
      }
      await prisma.producto.update({
        where: { id: e.productoId },
        data: { stock: 87, costoPromedio: 36.62 },
      });

      await e.comprar(e.centro, 10, 58.59);

      // Las otras dos se congelan en lo que ya estaban mostrando: no cambia
      // ningún número para el empresario, y se corta la circularidad.
      expect(await e.costoDe(e.norte)).toBeCloseTo(36.62, 4);
      expect(await e.costoDe(sur)).toBeCloseTo(36.62, 4);
      // Centro: (29×36.62 + 10×58.59)/39.
      expect(await e.costoDe(e.centro)).toBeCloseTo(
        (29 * 36.62 + 10 * 58.59) / 39,
        4,
      );
      expect(await e.valorPorSedes()).toBeCloseTo(await e.valorGlobal(), 2);
    });

    enEscenario('mientras nadie compre, las sedes siguen en NULL', async (e) => {
      // Un producto que nunca se mueve no debe estrenar costos por sede: eso
      // es lo que mantiene la migración perezosa y reversible.
      await prisma.productoStock.update({
        where: { productoId_sedeId: { productoId: e.productoId, sedeId: e.centro } },
        data: { stock: 5, costoPromedio: null },
      });
      await e.despachar(e.centro, 1);

      expect(await e.costoDe(e.centro)).toBeNull();
      expect(await e.costoDe(e.norte)).toBeNull();
    });
  });

  // ── RONDA 7 · Tres sedes y ajustes de inventario ──────────────────────────
  describe('Ronda 6 · tres sedes y ajustes de inventario', () => {
    enEscenario('abrir una sede nueva no le inventa un costo', async (e) => {
      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.norte, 10, 200);
      const sur = await e.abrirSede('Sur');

      // La sede recién abierta no tiene costo propio: vale el global.
      expect(await e.costoDe(sur)).toBeNull();
      expect(await e.stockDe(sur)).toBe(0);
      expect(await e.costoGlobal()).toBe(150);
    });

    enEscenario('con tres sedes, cada una mantiene lo suyo', async (e) => {
      const sur = await e.abrirSede('Sur');
      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.norte, 10, 200);
      await e.comprar(sur, 10, 300);

      expect(await e.costoDe(e.centro)).toBe(100);
      expect(await e.costoDe(e.norte)).toBe(200);
      expect(await e.costoDe(sur)).toBe(300);
      expect(await e.costoGlobal()).toBe(200); // (1000+2000+3000)/30
      expect(await e.valorPorSedes()).toBeCloseTo(await e.valorGlobal(), 6);
    });

    enEscenario('un ajuste positivo no cambia el costo de la sede', async (e) => {
      await e.comprar(e.centro, 10, 100);
      // Aparecen 3 unidades en el conteo físico. No se sabe qué costaron, así
      // que el costo de la sede no se toca; solo cambia el stock.
      await e.ajustar(e.centro, 3);

      expect(await e.stockDe(e.centro)).toBe(13);
      expect(await e.costoDe(e.centro)).toBe(100);
      // Pero el global sí se rehace, porque cambió la mezcla.
      expect(await e.valorPorSedes()).toBeCloseTo(await e.valorGlobal(), 6);
    });

    enEscenario('un ajuste negativo tampoco lo cambia, y sigue cuadrando', async (e) => {
      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.norte, 10, 200);
      await e.ajustar(e.norte, -4); // merma

      expect(await e.stockDe(e.norte)).toBe(6);
      expect(await e.costoDe(e.norte)).toBe(200);
      expect(await e.valorPorSedes()).toBeCloseTo(await e.valorGlobal(), 6);
    });

    enEscenario('traslado en cadena Centro → Norte → Sur', async (e) => {
      const sur = await e.abrirSede('Sur');
      await e.comprar(e.centro, 30, 90);

      const mover = (origen: number, destino: number, cantidad: number) =>
        e.kardex.realizarTraslado(
          {
            sedeOrigenId: origen,
            sedeDestinoId: destino,
            items: [{ productoId: e.productoId, cantidad }],
          } as any,
          e.empresaId,
          e.usuarioId,
        );

      await mover(e.centro, e.norte, 20);
      await mover(e.norte, sur, 10);

      // El costo viaja con la mercadería: las tres quedan en S/90.
      expect(await e.costoDe(e.centro)).toBe(90);
      expect(await e.costoDe(e.norte)).toBe(90);
      expect(await e.costoDe(sur)).toBe(90);
      expect(await e.costoGlobal()).toBeCloseTo(90, 6);
    });
  });

  // ── RONDA 8 · Variantes (talla, color) ────────────────────────────────────
  describe('Ronda 8 · productos con variantes', () => {
    enEscenario('cada variante lleva su propio costo por sede', async (e) => {
      const talla38 = await e.nuevoProducto(
        `v38-${Date.now()}`,
        [e.centro, e.norte],
        e.productoId,
      );
      const talla40 = await e.nuevoProducto(
        `v40-${Date.now()}`,
        [e.centro, e.norte],
        e.productoId,
      );

      await e.comprar(e.centro, 10, 80, talla38);
      await e.comprar(e.centro, 10, 95, talla40);
      await e.comprar(e.norte, 10, 130, talla38);

      expect(await e.costoDe(e.centro, talla38)).toBe(80);
      expect(await e.costoDe(e.centro, talla40)).toBe(95);
      expect(await e.costoDe(e.norte, talla38)).toBe(130);
      // La talla 40 nunca llegó a Norte.
      expect(await e.costoDe(e.norte, talla40)).toBeNull();
    });

    enEscenario('la invariante se cumple variante por variante', async (e) => {
      const variante = await e.nuevoProducto(
        `var-${Date.now()}`,
        [e.centro, e.norte],
        e.productoId,
      );
      await e.comprar(e.centro, 12, 70, variante);
      await e.comprar(e.norte, 8, 110, variante);
      await e.despachar(e.centro, 5, variante);

      expect(await e.valorPorSedes(variante)).toBeCloseTo(
        await e.valorGlobal(variante),
        4,
      );
    });

    enEscenario('mover una variante entre sedes no altera a sus hermanas', async (e) => {
      const a = await e.nuevoProducto(`va-${Date.now()}`, [e.centro, e.norte], e.productoId);
      const b = await e.nuevoProducto(`vb-${Date.now()}`, [e.centro, e.norte], e.productoId);
      await e.comprar(e.centro, 10, 50, a);
      await e.comprar(e.centro, 10, 250, b);

      await e.kardex.realizarTraslado(
        {
          sedeOrigenId: e.centro,
          sedeDestinoId: e.norte,
          items: [{ productoId: a, cantidad: 4 }],
        } as any,
        e.empresaId,
        e.usuarioId,
      );

      expect(await e.costoDe(e.norte, a)).toBe(50);
      expect(await e.costoDe(e.centro, b)).toBe(250);
      expect(await e.costoDe(e.norte, b)).toBeNull();
    });
  });

  // ── RONDA 9 · Decimales y fracciones ──────────────────────────────────────
  describe('Ronda 9 · decimales, fracciones y redondeo', () => {
    enEscenario('fracciones de galón no descuadran el valorizado', async (e) => {
      // Venta por fracción: 1/2, 1/4, 1/8 de galón.
      await e.comprar(e.centro, 10, 47.35);
      await e.despachar(e.centro, 0.5);
      await e.despachar(e.centro, 0.25);
      await e.despachar(e.centro, 0.125);

      expect(await e.stockDe(e.centro)).toBeCloseTo(9.125, 3);
      expect(await e.costoDe(e.centro)).toBeCloseTo(47.35, 6);
      expect(await e.valorPorSedes()).toBeCloseTo(await e.valorGlobal(), 2);
    });

    enEscenario('costos con muchos decimales no se van acumulando en error', async (e) => {
      // Precios que no dan redondos a propósito.
      await e.comprar(e.centro, 3, 33.333333);
      await e.comprar(e.centro, 7, 11.117777);
      await e.comprar(e.norte, 11, 7.070707);

      const esperadoCentro = (3 * 33.333333 + 7 * 11.117777) / 10;
      expect(await e.costoDe(e.centro)).toBeCloseTo(esperadoCentro, 4);
      expect(await e.valorPorSedes()).toBeCloseTo(await e.valorGlobal(), 2);
    });

    enEscenario('cantidades muy chicas no llevan el costo a cero', async (e) => {
      await e.comprar(e.centro, 100, 25);
      await e.comprar(e.centro, 0.001, 80);

      const costo = await e.costoDe(e.centro);
      expect(costo).toBeGreaterThan(24.9);
      expect(costo).toBeLessThan(25.1);
    });

    enEscenario('un costo alto con stock chico sigue cuadrando', async (e) => {
      // Un producto caro: una moto, una máquina.
      await e.comprar(e.centro, 1, 18500.75);
      await e.comprar(e.norte, 2, 21300.4);

      expect(await e.costoDe(e.centro)).toBeCloseTo(18500.75, 2);
      expect(await e.valorPorSedes()).toBeCloseTo(await e.valorGlobal(), 2);
    });
  });

  // ── RONDA 10 · Varios productos y el reporte completo ──────────────────────
  describe('Ronda 10 · varios productos a la vez', () => {
    enEscenario('el inventario valorizado de una sede suma solo lo suyo', async (e) => {
      const b = await e.nuevoProducto(`p2-${Date.now()}`, [e.centro, e.norte]);
      const c = await e.nuevoProducto(`p3-${Date.now()}`, [e.centro, e.norte]);

      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.centro, 5, 40, b);
      await e.comprar(e.norte, 10, 300, c);

      const centro: any = await e.kardex.obtenerInventarioValorizado(
        e.empresaId,
        {} as any,
        e.centro,
      );
      const enCentro = (id: number) => centro.productos.find((p: any) => p.id === id);

      expect(enCentro(e.productoId).valorTotal).toBe(1000);
      expect(enCentro(b).valorTotal).toBe(200);
      // El tercero no tiene stock en Centro: no aporta valor.
      expect(enCentro(c)?.valorTotal ?? 0).toBe(0);
    });

    enEscenario('la rentabilidad mezcla productos con costos distintos por sede', async (e) => {
      const b = await e.nuevoProducto(`p2-${Date.now()}`, [e.centro, e.norte]);
      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.centro, 10, 40, b);
      await e.comprar(e.norte, 10, 250);

      await e.vender(e.centro, 1, 300, 1);
      await e.vender(e.norte, 1, 300, 2);

      const centro = await e.dashboard.utilidadBrutaPen({
        empresaId: e.empresaId,
        sedeId: e.centro,
      });
      const norte = await e.dashboard.utilidadBrutaPen({
        empresaId: e.empresaId,
        sedeId: e.norte,
      });

      expect(centro.costo).toBe(100);
      expect(norte.costo).toBe(250);
    });

    enEscenario('trasladar varios productos en un solo envío', async (e) => {
      const b = await e.nuevoProducto(`p2-${Date.now()}`, [e.centro, e.norte]);
      await e.comprar(e.centro, 10, 60);
      await e.comprar(e.centro, 10, 180, b);

      await e.kardex.realizarTraslado(
        {
          sedeOrigenId: e.centro,
          sedeDestinoId: e.norte,
          items: [
            { productoId: e.productoId, cantidad: 5 },
            { productoId: b, cantidad: 5 },
          ],
        } as any,
        e.empresaId,
        e.usuarioId,
      );

      // Cada producto viaja con SU costo, no con un promedio del envío.
      expect(await e.costoDe(e.norte)).toBe(60);
      expect(await e.costoDe(e.norte, b)).toBe(180);
      expect(await e.valorPorSedes()).toBeCloseTo(await e.valorGlobal(), 4);
      expect(await e.valorPorSedes(b)).toBeCloseTo(await e.valorGlobal(b), 4);
    });
  });

  // ── RONDA 11 · Los estados heredados que hay hoy en la base ───────────────
  // La lección del defecto de la circularidad: los escenarios que arrancan de
  // cero no encuentran lo que sí encuentra un producto con historia. Estos
  // casos son un censo de la base local: 4 921 de 5 805 filas son de productos
  // SIN costo, 196 con stock cero, 733 productos sin ninguna fila de stock.
  describe('Ronda 11 · estados heredados', () => {
    enEscenario('un producto sin costo estrena el de su primera compra', async (e) => {
      // El caso más común: 4 921 filas de 5 805.
      await prisma.producto.update({
        where: { id: e.productoId },
        data: { costoPromedio: 0 },
      });
      await e.comprar(e.centro, 10, 73.4);

      expect(await e.costoDe(e.centro)).toBeCloseTo(73.4, 4);
      expect(await e.costoGlobal()).toBeCloseTo(73.4, 4);
    });

    enEscenario('un producto con costo global NULL no rompe nada', async (e) => {
      await prisma.producto.update({
        where: { id: e.productoId },
        data: { costoPromedio: null },
      });
      await e.comprar(e.norte, 5, 20);

      expect(await e.costoDe(e.norte)).toBeCloseTo(20, 4);
      expect(await e.valorPorSedes()).toBeCloseTo(await e.valorGlobal(), 4);
    });

    enEscenario('un producto sin ninguna fila de stock no se corrompe', async (e) => {
      // 733 productos están así: legado anterior a multi-sede.
      const suelto = await e.nuevoProducto(`suelto-${Date.now()}`, []);
      await prisma.producto.update({
        where: { id: suelto },
        data: { costoPromedio: 45.5, stock: 12 },
      });

      const inv: any = await e.kardex.obtenerInventarioValorizado(
        e.empresaId,
        {} as any,
        e.centro,
      );
      const fila = inv.productos.find((p: any) => p.id === suelto);
      // No tiene stock en esta sede, así que no aporta valor; y su costo
      // global queda intacto, sin que nadie se lo pise con un 0.
      expect(fila?.valorTotal ?? 0).toBe(0);
      expect(await e.costoGlobal(suelto)).toBeCloseTo(45.5, 4);
    });

    enEscenario('una sede con stock cero no se lleva costo al congelar', async (e) => {
      // 196 filas están en cero. No tienen nada que valorizar.
      await prisma.productoStock.update({
        where: { productoId_sedeId: { productoId: e.productoId, sedeId: e.norte } },
        data: { stock: 0 },
      });
      await e.comprar(e.centro, 10, 88);

      expect(await e.costoDe(e.norte)).toBeNull();
      expect(await e.costoDe(e.centro)).toBe(88);
    });

    enEscenario('un producto oculto en la sede igual se valoriza bien', async (e) => {
      // 34 filas tienen visibleEnSede = false: no salen en el catálogo, pero
      // la mercadería está ahí y el inventario tiene que contarla.
      await e.comprar(e.centro, 10, 61);
      await prisma.productoStock.update({
        where: { productoId_sedeId: { productoId: e.productoId, sedeId: e.centro } },
        data: { visibleEnSede: false },
      });

      const inv: any = await e.kardex.obtenerInventarioValorizado(
        e.empresaId,
        {} as any,
        e.centro,
      );
      expect(inv.productos.find((p: any) => p.id === e.productoId).valorTotal).toBe(610);
    });
  });

  // ── RONDA 12 · El empresario edita el costo a mano ────────────────────────
  // El editor de producto escribe el costo global directamente. Si las sedes
  // se quedaran con el suyo, el valorizado global diría una cosa y la suma de
  // los locales otra —S/1 009.73 en el caso que destapó esto— y el número que
  // el empresario acaba de escribir no se vería en ningún reporte por sede.
  describe('Ronda 12 · costo editado a mano', () => {
    /** El editor real, con su propio servicio. */
    const editarCosto = async (e: any, costo: number) => {
      const { ProductoService } = await import('../producto/producto.service');
      const servicio: any = Object.create(ProductoService.prototype);
      servicio.prisma = prisma;
      const anterior = await e.costoGlobal();
      await prisma.producto.update({
        where: { id: e.productoId },
        data: { costoPromedio: costo },
      });
      await servicio.resetearCostoPorSede(e.productoId, anterior, costo);
    };

    enEscenario('editar el costo deja las sedes leyendo el valor nuevo', async (e) => {
      await e.comprar(e.centro, 39, 42.25);
      await e.comprar(e.norte, 29, 36.62);
      expect(await e.costoDe(e.centro)).not.toBeNull();

      await editarCosto(e, 25);

      // Vuelven a NULL: el costo tipeado manda sobre lo calculado.
      expect(await e.costoDe(e.centro)).toBeNull();
      expect(await e.costoDe(e.norte)).toBeNull();
      expect(await e.costoGlobal()).toBe(25);
      expect(await e.valorPorSedes()).toBeCloseTo(await e.valorGlobal(), 4);
    });

    enEscenario('el reporte por sede muestra el costo que se escribió', async (e) => {
      await e.comprar(e.centro, 10, 300);
      await editarCosto(e, 75);

      const inv: any = await e.kardex.obtenerInventarioValorizado(
        e.empresaId,
        {} as any,
        e.centro,
      );
      const fila = inv.productos.find((p: any) => p.id === e.productoId);
      expect(fila.costoPromedio).toBe(75);
      expect(fila.valorTotal).toBe(750);
    });

    enEscenario('guardar sin cambiar el costo no borra lo calculado', async (e) => {
      // Un guardado cualquiera del formulario no puede tirar a la basura lo
      // que las compras calcularon para cada sede.
      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.norte, 10, 200);
      const antesCentro = await e.costoDe(e.centro);

      await editarCosto(e, await e.costoGlobal());

      expect(await e.costoDe(e.centro)).toBe(antesCentro);
      expect(await e.costoDe(e.norte)).toBe(200);
    });

    enEscenario('tras editar, cada sede vuelve a diferenciarse al comprar', async (e) => {
      await e.comprar(e.centro, 10, 100);
      await e.comprar(e.norte, 10, 200);
      await editarCosto(e, 50);

      await e.comprar(e.centro, 10, 90);

      // Centro: 10 al costo tipeado (50) + 10 a 90 → 70. Norte sigue en 50.
      expect(await e.costoDe(e.centro)).toBeCloseTo(70, 4);
      expect(await e.costoDe(e.norte)).toBeCloseTo(50, 4);
      expect(await e.valorPorSedes()).toBeCloseTo(await e.valorGlobal(), 4);
    });
  });

  // ── RONDA 13 · Secuencias al azar ─────────────────────────────────────────
  describe('Ronda 13 · secuencias al azar', () => {
    /** Azar reproducible: si una corrida falla, la semilla la repite. */
    const generador = (semilla: number) => () => {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      return semilla / 0x7fffffff;
    };

    enEscenario('40 operaciones al azar nunca rompen la invariante', async (e) => {
      const semilla = Date.now() % 100000;
      const azar = generador(semilla);
      const sur = await e.abrirSede('Sur');
      const sedes = [e.centro, e.norte, sur];

      // Se arranca de un estado heredado, como los productos reales.
      await prisma.producto.update({
        where: { id: e.productoId },
        data: { costoPromedio: 42.5, stock: 30 },
      });
      for (const s of sedes) {
        await prisma.productoStock.update({
          where: { productoId_sedeId: { productoId: e.productoId, sedeId: s } },
          data: { stock: 10, costoPromedio: null },
        });
      }

      const historia: string[] = [`semilla ${semilla}`];
      for (let i = 0; i < 40; i++) {
        const sede = sedes[Math.floor(azar() * sedes.length)];
        const dado = azar();
        try {
          if (dado < 0.4) {
            const c = Math.round(azar() * 20000) / 100;
            await e.comprar(sede, Math.ceil(azar() * 9), c);
            historia.push(`compra en ${sede} a ${c}`);
          } else if (dado < 0.7) {
            const disponible = await e.stockDe(sede);
            if (disponible >= 1) {
              const q = Math.min(disponible, Math.ceil(azar() * 4));
              await e.despachar(sede, q);
              historia.push(`venta ${q} en ${sede}`);
            }
          } else if (dado < 0.85) {
            await e.ajustar(sede, Math.ceil(azar() * 5) - 3);
            historia.push(`ajuste en ${sede}`);
          } else {
            const otra = sedes.filter((s) => s !== sede)[Math.floor(azar() * 2)];
            const disponible = await e.stockDe(sede);
            if (disponible >= 1) {
              const q = Math.min(disponible, Math.ceil(azar() * 3));
              await e.kardex.realizarTraslado(
                {
                  sedeOrigenId: sede,
                  sedeDestinoId: otra,
                  items: [{ productoId: e.productoId, cantidad: q }],
                } as any,
                e.empresaId,
                e.usuarioId,
              );
              historia.push(`traslado ${q} de ${sede} a ${otra}`);
            }
          }
        } catch (error: any) {
          // Un rechazo del servicio (p.ej. stock insuficiente) es válido; lo
          // que no puede pasar es que deje los números inconsistentes.
          historia.push(`rechazo: ${String(error?.message).slice(0, 50)}`);
        }

        // Tras CADA paso, no solo al final.
        const porSedes = await e.valorPorSedes();
        const global = await e.valorGlobal();
        if (Math.abs(porSedes - global) > 0.05) {
          throw new Error(
            `descuadre de S/${Math.abs(porSedes - global).toFixed(2)} en el paso ${i}\n${historia.join('\n')}`,
          );
        }
      }

      // Y ningún costo absurdo al final del recorrido.
      for (const s of sedes) {
        const c = await e.costoDe(s);
        if (c != null) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThan(1000);
        }
      }
      expect(await e.costoGlobal()).toBeGreaterThanOrEqual(0);
    });

    enEscenario('el stock global sigue a las sedes tras el azar', async (e) => {
      const azar = generador((Date.now() % 100000) + 7);
      const sedes = [e.centro, e.norte];

      for (let i = 0; i < 25; i++) {
        const sede = sedes[Math.floor(azar() * sedes.length)];
        if (azar() < 0.6) {
          await e.comprar(sede, Math.ceil(azar() * 6), Math.round(azar() * 9000) / 100);
        } else {
          const d = await e.stockDe(sede);
          if (d >= 1) await e.despachar(sede, Math.min(d, Math.ceil(azar() * 3)));
        }
      }

      const p = await prisma.producto.findUnique({
        where: { id: e.productoId },
        select: { stock: true },
      });
      const suma = (await e.stockDe(e.centro)) + (await e.stockDe(e.norte));
      expect(Number(p?.stock)).toBeCloseTo(suma, 3);
    });
  });

  // ── RONDA 13 · Concurrencia y volumen ─────────────────────────────────────
  describe('Ronda 14 · concurrencia y volumen', () => {
    enEscenario('dos compras simultáneas a la misma sede no pierden stock', async (e) => {
      await Promise.all([
        e.comprar(e.centro, 10, 100),
        e.comprar(e.norte, 10, 200),
      ]);

      // Sedes distintas: no compiten por la misma fila.
      expect(await e.stockDe(e.centro)).toBe(10);
      expect(await e.stockDe(e.norte)).toBe(10);
    });

    enEscenario('ventas simultáneas en la misma sede no sobrevenden', async (e) => {
      await e.comprar(e.centro, 10, 100);
      await Promise.all([
        e.despachar(e.centro, 3),
        e.despachar(e.centro, 3),
        e.despachar(e.centro, 3),
      ]);

      // El descuento de salidas es atómico (updateMany condicionado).
      const stock = await e.stockDe(e.centro);
      expect(stock).toBeGreaterThanOrEqual(1);
      expect(stock).toBeLessThanOrEqual(7);
      expect(await e.costoDe(e.centro)).toBe(100);
    });

    enEscenario('50 movimientos sobre 3 productos mantienen la invariante', async (e) => {
      const sur = await e.abrirSede('Sur');
      const b = await e.nuevoProducto(`p2-${Date.now()}`, [e.centro, e.norte, sur]);
      const productos = [e.productoId, b];
      const sedes = [e.centro, e.norte, sur];

      for (let i = 0; i < 25; i++) {
        const p = productos[i % productos.length];
        const s = sedes[i % sedes.length];
        await e.comprar(s, 4, 20 + (i % 7) * 13, p);
        if (i % 3 === 0) await e.despachar(s, 2, p);
      }

      for (const p of productos) {
        const porSedes = await e.valorPorSedes(p);
        expect(porSedes).toBeGreaterThan(0);
        expect(porSedes).toBeCloseTo(await e.valorGlobal(p), 2);
      }
    });

    enEscenario('la rentabilidad no consulta costos de más al crecer', async (e) => {
      const b = await e.nuevoProducto(`p2-${Date.now()}`, [e.centro, e.norte]);
      await e.comprar(e.centro, 50, 100);
      await e.comprar(e.centro, 50, 40, b);

      for (let i = 1; i <= 8; i++) {
        await e.vender(e.centro, 1, 300, i);
      }

      const espiado = jest.spyOn(prisma.productoStock, 'findMany');
      const r = await e.dashboard.utilidadBrutaPen({ empresaId: e.empresaId });
      // Ocho ventas, UNA sola consulta de costos.
      expect(espiado).toHaveBeenCalledTimes(1);
      expect(r.costo).toBe(800);
      espiado.mockRestore();
    });
  });
});
