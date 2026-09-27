/**
 * Prueba de integración del costeo por sede contra una base PostgreSQL real.
 *
 * Lo que valida —y que una prueba de la fórmula sola no puede— es que el doble
 * escrito funcione de punta a punta: que un ingreso en una sede deje el costo
 * de ESA sede y el global, que el costo de una sede NO se contagie a la otra, y
 * que una sede sin movimientos se quede en NULL valiendo el global.
 *
 * Corre solo si hay base local. NUNCA contra producción: crea y borra datos.
 *   DATABASE_URL_TEST="postgresql://postgres:developer@localhost:5432/sistema_mype" \
 *     NINJA_ENV=parentDisabled npx jest --runInBand src/kardex/costo-sede.integracion
 */
import { PrismaClient } from '@prisma/client';
import { KardexService } from './kardex.service';
import { costoDeSede } from './costo-sede';

const URL = process.env.DATABASE_URL_TEST;
const describeSiHayBase = URL ? describe : describe.skip;

describeSiHayBase('Costo por sede · contra base real', () => {
  let prisma: PrismaClient;
  let servicio: KardexService;
  let empresaId: number;
  let sedeA: number;
  let sedeB: number;
  let productoId: number;

  /** Ejecuta el recálculo de costos tal como lo hace un movimiento de kardex. */
  const ingreso = (sedeId: number, stockNuevo: number, cantidad: number, costo: number) =>
    (servicio as any).actualizarStockYCosto(
      productoId,
      sedeId,
      stockNuevo,
      'INGRESO',
      costo,
      cantidad,
    );

  const leerSede = (sedeId: number) =>
    prisma.productoStock.findUnique({
      where: { productoId_sedeId: { productoId, sedeId } },
      select: { stock: true, costoPromedio: true },
    });

  const leerGlobal = async () =>
    Number(
      (
        await prisma.producto.findUnique({
          where: { id: productoId },
          select: { costoPromedio: true },
        })
      )?.costoPromedio ?? 0,
    );

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    servicio = new KardexService(prisma as any, {} as any, {} as any);

    const marca = `costo-sede-${Date.now()}`;
    // Se reutilizan un plan y una unidad de medida existentes: lo que se prueba
    // es el costeo, no el alta de catálogos.
    const plan = await prisma.plan.findFirst({ select: { id: true } });
    const unidad = await prisma.unidadMedida.findFirst({ select: { id: true } });
    if (!plan || !unidad) throw new Error('la base local no tiene plan/unidad para la prueba');

    const anio = 1000 * 60 * 60 * 24 * 365;
    const empresa = await prisma.empresa.create({
      data: {
        razonSocial: marca,
        direccion: 'Prueba',
        ruc: `${Date.now()}`.slice(-11),
        planId: plan.id,
        fechaActivacion: new Date(),
        fechaExpiracion: new Date(Date.now() + anio),
      },
      select: { id: true },
    });
    empresaId = empresa.id;
    const [a, b] = await Promise.all([
      prisma.sede.create({ data: { nombre: 'Centro', empresaId }, select: { id: true } }),
      prisma.sede.create({ data: { nombre: 'Norte', empresaId }, select: { id: true } }),
    ]);
    sedeA = a.id;
    sedeB = b.id;

    const producto = await prisma.producto.create({
      data: {
        codigo: marca,
        descripcion: marca,
        empresaId,
        unidadMedidaId: unidad.id,
        tipoAfectacionIGV: '10',
        precioUnitario: 0,
        valorUnitario: 0,
        costoPromedio: 0,
        stock: 0,
      },
      select: { id: true },
    });
    productoId = producto.id;
    await prisma.productoStock.createMany({
      data: [
        { productoId, sedeId: sedeA, stock: 0 },
        { productoId, sedeId: sedeB, stock: 0 },
      ],
    });
  });

  afterAll(async () => {
    if (empresaId) await prisma.empresa.delete({ where: { id: empresaId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('el primer ingreso estrena el costo de esa sede y el global', async () => {
    await ingreso(sedeA, 10, 10, 100);

    const a = await leerSede(sedeA);
    expect(Number(a?.costoPromedio)).toBe(100);
    expect(await leerGlobal()).toBe(100);
  });

  it('la otra sede sigue en NULL y por lo tanto vale el global', async () => {
    const b = await leerSede(sedeB);
    expect(b?.costoPromedio).toBeNull();
    // Esto es lo que hace que agregar la columna no cambie ningún reporte.
    expect(costoDeSede(b?.costoPromedio, await leerGlobal())).toBe(100);
  });

  it('un ingreso más caro en la otra sede NO contamina a la primera', async () => {
    // Es el punto de todo el cambio: hoy este ingreso movería el costo de las
    // dos sedes por igual, aunque Centro nunca pagó S/200.
    await ingreso(sedeB, 10, 10, 200);

    expect(Number((await leerSede(sedeB))?.costoPromedio)).toBe(200);
    expect(Number((await leerSede(sedeA))?.costoPromedio)).toBe(100);
  });

  it('el costo global sigue siendo el ponderado de todo, como antes', async () => {
    // 10 a S/100 + 10 a S/200 = 3000/20 = S/150. Los reportes que leen el
    // global no cambian de número mientras dure la convivencia.
    expect(await leerGlobal()).toBe(150);
  });

  it('un segundo ingreso a una sede pondera contra su propio costo', async () => {
    // Centro estaba en 10 a S/100; entran 10 a S/140 → S/120 en Centro.
    // Si ponderara contra el global (S/150) daría S/145: eso sería el bug.
    await ingreso(sedeA, 20, 10, 140);

    expect(Number((await leerSede(sedeA))?.costoPromedio)).toBe(120);
    expect(Number((await leerSede(sedeB))?.costoPromedio)).toBe(200);
  });
});
