/**
 * QA funcional: ¿la comisión de fin de semana usa la fecha de la venta o la de hoy?
 *
 * Reportado por IMPORTEMOS JUNTOS: "por más que le pongo una fecha de sábado me
 * está comisionando como día de semana, porque entiendo que el sistema me lee
 * como hoy día".
 *
 *   DATABASE_URL_TEST="postgresql://postgres:developer@localhost:5432/qa_finde" \
 *     NINJA_ENV=parentDisabled npx jest --runInBand src/comisiones/fecha-venta.qa
 */
import { PrismaClient } from '@prisma/client';
import { ComisionesService } from './comisiones.service';
import type { PrismaService } from '../prisma/prisma.service';

const URL = process.env.DATABASE_URL_TEST;
const describeSiHayBase = URL ? describe : describe.skip;
const prisma = new PrismaClient({ datasources: { db: { url: URL ?? '' } } });
const servicio = new ComisionesService(prisma as unknown as PrismaService);

let empresaId: number, vendedorId: number, productoId: number, clienteId: number;
let planId: number, unidadId: number, sedeId: number;
let correlativo = 1;

beforeAll(async () => {
  if (!URL) return;
  const sello = Date.now();
  planId = (await prisma.plan.create({ data: { nombre: `QA ${sello}` }, select: { id: true } })).id;
  unidadId = (await prisma.unidadMedida.create({
    data: { codigo: `Q${sello}`.slice(0,10), nombre: 'U' }, select: { id: true } })).id;
  empresaId = (await prisma.empresa.create({
    data: { ruc: `20${sello}`.slice(0,11), razonSocial: 'QA FINDE', direccion: 'x',
            planId, fechaActivacion: new Date(), fechaExpiracion: new Date(2030,0,1) },
    select: { id: true } })).id;
  sedeId = (await prisma.sede.create({ data: { nombre: 'P', empresaId }, select: { id: true } })).id;
  vendedorId = (await prisma.usuario.create({
    data: { nombre: 'Joshi', dni: '0', celular: '9', email: `v${sello}@localhost.test`,
            password: 'x', rol: 'USUARIO_EMPRESA', empresaId }, select: { id: true } })).id;
  clienteId = (await prisma.cliente.create({
    data: { nombre: 'C', nroDoc: '1', empresaId }, select: { id: true } })).id;
  // Comisión habitual S/3; fin de semana S/9.
  productoId = (await prisma.producto.create({
    data: { codigo: `P${sello}`, descripcion: 'Holder', unidadMedidaId: unidadId,
            tipoAfectacionIGV: '10', precioUnitario: 100, valorUnitario: 84.75,
            empresaId, comisionPorVenta: 3 }, select: { id: true } })).id;
  await prisma.reglaComision.create({
    data: { empresaId, productoId, diasSemana: '0,6', montoFijo: 9 } });
});

afterAll(async () => {
  if (!URL) return;
  await prisma.comisionVendedor.deleteMany({ where: { empresaId } });
  await prisma.reglaComision.deleteMany({ where: { empresaId } });
  await prisma.detalleComprobante.deleteMany({ where: { comprobante: { empresaId } } });
  await prisma.comprobante.deleteMany({ where: { empresaId } });
  await prisma.producto.deleteMany({ where: { empresaId } });
  await prisma.cliente.deleteMany({ where: { empresaId } });
  await prisma.usuario.deleteMany({ where: { empresaId } });
  await prisma.sede.deleteMany({ where: { empresaId } });
  await prisma.empresa.deleteMany({ where: { id: empresaId } });
  await prisma.plan.deleteMany({ where: { id: planId } });
  await prisma.unidadMedida.deleteMany({ where: { id: unidadId } });
  await prisma.$disconnect();
});

/** Emite una venta CON la fecha indicada y devuelve la comisión que generó. */
const venderCon = async (fechaEmision: string) => {
  const comp = await prisma.comprobante.create({
    data: {
      tipoDoc: 'NV', serie: 'NV01', correlativo: correlativo++,
      fechaEmision: new Date(fechaEmision),
      formaPagoTipo: 'Contado', formaPagoMoneda: 'PEN', tipoMoneda: 'PEN',
      mtoOperGravadas: 0, mtoIGV: 0, valorVenta: 0, totalImpuestos: 0,
      subTotal: 100, mtoImpVenta: 100, clienteId, empresaId, sedeId,
    }, select: { id: true },
  });
  await servicio.registrarComisionesDesdeComprobante({
    comprobanteId: comp.id, empresaId, vendedorId,
    fechaEmision: new Date(fechaEmision),
    detalles: [{ productoId, descripcion: 'Holder', cantidad: 1, mtoPrecioUnitario: 100 }],
  });
  const c = await prisma.comisionVendedor.findMany({
    where: { comprobanteId: comp.id }, select: { montoComision: true, motivo: true },
  });
  return { monto: c.reduce((s, x) => s + Number(x.montoComision), 0), motivo: c[0]?.motivo ?? '' };
};

describeSiHayBase('La comisión usa la fecha de la VENTA, no la de hoy', () => {
  it('una venta fechada el sábado 5 de setiembre paga tarifa de fin de semana', async () => {
    // Es la prueba exacta que dice IMPORTEMOS JUNTOS que le falla.
    const r = await venderCon('2026-09-05T15:00:00.000Z');
    expect(r.monto).toBe(9);
    expect(r.motivo).toContain('fin de semana');
  });

  it('el domingo 6 también', async () => {
    expect((await venderCon('2026-09-06T15:00:00.000Z')).monto).toBe(9);
  });

  it('un martes paga la comisión habitual', async () => {
    const r = await venderCon('2026-09-29T15:00:00.000Z');
    expect(r.monto).toBe(3);
    expect(r.motivo).toContain('Comisión fija del producto');
  });

  it('el período se guarda con el mes de la VENTA, no el de hoy', async () => {
    const comp = await prisma.comprobante.create({
      data: { tipoDoc: 'NV', serie: 'NV01', correlativo: correlativo++,
              fechaEmision: new Date('2026-09-05T15:00:00.000Z'),
              formaPagoTipo: 'Contado', formaPagoMoneda: 'PEN', tipoMoneda: 'PEN',
              mtoOperGravadas: 0, mtoIGV: 0, valorVenta: 0, totalImpuestos: 0,
              subTotal: 100, mtoImpVenta: 100, clienteId, empresaId, sedeId },
      select: { id: true } });
    await servicio.registrarComisionesDesdeComprobante({
      comprobanteId: comp.id, empresaId, vendedorId,
      fechaEmision: new Date('2026-09-05T15:00:00.000Z'),
      detalles: [{ productoId, descripcion: 'Holder', cantidad: 1, mtoPrecioUnitario: 100 }] });
    const [c] = await prisma.comisionVendedor.findMany({
      where: { comprobanteId: comp.id }, select: { mes: true, anio: true } });
    expect({ mes: c.mes, anio: c.anio }).toEqual({ mes: 9, anio: 2026 });
  });
});
