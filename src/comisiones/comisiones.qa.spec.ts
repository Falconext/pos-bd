/**
 * QA funcional de las comisiones, contra base de datos real.
 *
 * Esto es plata de un vendedor, así que no alcanza con probar el selector de
 * reglas en aislamiento: lo que se prueba acá es el servicio entero —consulta
 * a la base incluida— emitiendo comprobantes de verdad.
 *
 * La prueba más importante de todo el archivo es la primera: una empresa que
 * no cargó ninguna regla tiene que cobrar exactamente lo mismo que antes.
 *
 * Se salta solo si no hay base configurada, igual que el resto de QA del repo:
 *
 *   DATABASE_URL_TEST="postgresql://postgres:developer@localhost:5432/qa_comisiones" \
 *     NINJA_ENV=parentDisabled npx jest --runInBand src/comisiones/comisiones.qa
 *
 * La base debe ser DESECHABLE. Nunca la de Railway: es producción.
 */
import { PrismaClient } from '@prisma/client';
import { ComisionesService } from './comisiones.service';
import type { PrismaService } from '../prisma/prisma.service';

const URL = process.env.DATABASE_URL_TEST;
const describeSiHayBase = URL ? describe : describe.skip;

const prisma = new PrismaClient({ datasources: { db: { url: URL ?? '' } } });
const servicio = new ComisionesService(prisma as unknown as PrismaService);

/** Setiembre 2026: 26 sábado, 27 domingo, 28 lunes. Mediodía de Lima. */
const enLima = (dia: number, hora = 12) => new Date(Date.UTC(2026, 8, dia, hora + 5));
const SABADO = enLima(26);
const DOMINGO = enLima(27);
const LUNES = enLima(28);

let empresaId: number;
let otraEmpresaId: number;
let vendedorId: number;
let otroVendedorId: number;
let ajenoId: number;
let productoA: number;
let productoB: number;
let clienteId: number;
let planId: number;
let unidadId: number;
let correlativo = 1;

const nuevaEmpresa = async (ruc: string, planId: number) =>
  (await prisma.empresa.create({
    data: {
      ruc, razonSocial: `QA ${ruc}`, direccion: 'x', planId,
      fechaActivacion: new Date(), fechaExpiracion: new Date(2030, 0, 1),
    },
    select: { id: true },
  })).id;

const nuevoVendedor = async (email: string, empresa: number, extra = {}) =>
  (await prisma.usuario.create({
    data: {
      nombre: email, dni: '00000000', celular: '9', email, password: 'x',
      rol: 'USUARIO_EMPRESA', empresaId: empresa, ...extra,
    },
    select: { id: true },
  })).id;

const nuevoProducto = async (codigo: string, empresa: number, unidadId: number, extra = {}) =>
  (await prisma.producto.create({
    data: {
      codigo, descripcion: `Producto ${codigo}`, unidadMedidaId: unidadId,
      tipoAfectacionIGV: '10', precioUnitario: 100, valorUnitario: 84.75,
      empresaId: empresa, ...extra,
    },
    select: { id: true },
  })).id;

/** Emite un comprobante y devuelve las comisiones que generó. */
const vender = async (opciones: {
  fecha: Date;
  productoId: number;
  cantidad?: number;
  precio?: number;
  vendedor?: number;
}) => {
  const { fecha, productoId, cantidad = 2, precio = 100, vendedor = vendedorId } = opciones;
  const comprobante = await prisma.comprobante.create({
    data: {
      tipoDoc: '03', serie: 'B001', correlativo: correlativo++, fechaEmision: fecha,
      formaPagoTipo: 'Contado', formaPagoMoneda: 'PEN', tipoMoneda: 'PEN',
      mtoOperGravadas: 0, mtoIGV: 0, valorVenta: 0, totalImpuestos: 0,
      subTotal: 0, mtoImpVenta: precio * cantidad, clienteId, empresaId,
    },
    select: { id: true },
  });
  await servicio.registrarComisionesDesdeComprobante({
    comprobanteId: comprobante.id, empresaId, vendedorId: vendedor, fechaEmision: fecha,
    detalles: [{ productoId, descripcion: 'x', cantidad, mtoPrecioUnitario: precio }],
  });
  return prisma.comisionVendedor.findMany({
    where: { comprobanteId: comprobante.id },
    select: { montoComision: true, motivo: true, productoId: true },
  });
};

const total = (comisiones: Array<{ montoComision: unknown }>) =>
  Number(comisiones.reduce((s, c) => s + Number(c.montoComision), 0).toFixed(2));

beforeAll(async () => {
  if (!URL) return;
  // Nombres únicos por corrida: el plan tiene unique (nombre, plataforma,
  // producto) y con un nombre fijo la suite solo corría una vez.
  const sello = Date.now();
  planId = (await prisma.plan.create({
    data: { nombre: `QA ${sello}` }, select: { id: true },
  })).id;
  unidadId = (await prisma.unidadMedida.create({
    data: { codigo: `QA${sello}`.slice(0, 10), nombre: 'Unidad' }, select: { id: true },
  })).id;
  empresaId = await nuevaEmpresa(`20${sello}`.slice(0, 11), planId);
  otraEmpresaId = await nuevaEmpresa(`21${sello}`.slice(0, 11), planId);
  vendedorId = await nuevoVendedor(`joshi${Date.now()}@qa.pe`, empresaId);
  otroVendedorId = await nuevoVendedor(`fatima${Date.now()}@qa.pe`, empresaId);
  ajenoId = await nuevoVendedor(`ajeno${Date.now()}@qa.pe`, otraEmpresaId);
  // Comisión fija de S/3 por unidad: la configuración de siempre.
  productoA = await nuevoProducto(`A${Date.now()}`, empresaId, unidadId, { comisionPorVenta: 3 });
  productoB = await nuevoProducto(`B${Date.now()}`, empresaId, unidadId, { comisionPorVenta: 3 });
  clienteId = (await prisma.cliente.create({
    data: { nombre: 'Cliente QA', nroDoc: '00000000', empresaId }, select: { id: true },
  })).id;
});

afterEach(async () => {
  if (!URL) return;
  await prisma.reglaComision.deleteMany({ where: { empresaId } });
});

afterAll(async () => {
  if (!URL) return;
  await prisma.comisionVendedor.deleteMany({ where: { empresaId } });
  await prisma.comprobante.deleteMany({ where: { empresaId } });
  await prisma.reglaComision.deleteMany({ where: { empresaId } });
  await prisma.producto.deleteMany({ where: { empresaId } });
  await prisma.cliente.deleteMany({ where: { empresaId } });
  await prisma.usuario.deleteMany({ where: { empresaId: { in: [empresaId, otraEmpresaId] } } });
  await prisma.empresa.deleteMany({ where: { id: { in: [empresaId, otraEmpresaId] } } });
  // El plan y la unidad se borran al final: si quedan, la próxima corrida
  // choca contra el unique y la suite entera falla en el beforeAll.
  await prisma.plan.deleteMany({ where: { id: planId } });
  await prisma.unidadMedida.deleteMany({ where: { id: unidadId } });
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describeSiHayBase('1. Una empresa sin reglas cobra exactamente lo de antes', () => {
  it('sábado paga la comisión del producto, no otra cosa', async () => {
    expect(total(await vender({ fecha: SABADO, productoId: productoA }))).toBe(6);
  });

  it('lunes paga lo mismo que el sábado', async () => {
    expect(total(await vender({ fecha: LUNES, productoId: productoA }))).toBe(6);
  });

  it('el motivo sigue diciendo "Comisión fija del producto"', async () => {
    const [c] = await vender({ fecha: SABADO, productoId: productoA });
    expect(c.motivo).toContain('Comisión fija del producto');
  });
});

describeSiHayBase('2. El pedido de IMPORTEMOS JUNTOS: fin de semana paga más', () => {
  const cargarFinDeSemana = (monto = 9, extra = {}) =>
    prisma.reglaComision.create({
      data: { empresaId, diasSemana: '0,6', montoFijo: monto, ...extra },
    });

  it('sábado paga la regla (9×2), no la del producto (3×2)', async () => {
    await cargarFinDeSemana();
    expect(total(await vender({ fecha: SABADO, productoId: productoA }))).toBe(18);
  });

  it('domingo también', async () => {
    await cargarFinDeSemana();
    expect(total(await vender({ fecha: DOMINGO, productoId: productoA }))).toBe(18);
  });

  it('lunes vuelve a la del producto', async () => {
    await cargarFinDeSemana();
    expect(total(await vender({ fecha: LUNES, productoId: productoA }))).toBe(6);
  });

  it('el motivo guardado dice "fin de semana", no "0,6"', async () => {
    await cargarFinDeSemana();
    const [c] = await vender({ fecha: SABADO, productoId: productoA });
    expect(c.motivo).toBe('Regla de comisión (fin de semana): S/ 9.00 × 2 und.');
  });

  it('aplica a cualquiera que venda el domingo, no solo a Joshi', async () => {
    // Si Fátima cubre un domingo cobra la tarifa del domingo, sin configurar nada.
    await cargarFinDeSemana();
    expect(total(await vender({ fecha: DOMINGO, productoId: productoA, vendedor: otroVendedorId })))
      .toBe(18);
  });

  it('una regla desactivada no cambia nada', async () => {
    await cargarFinDeSemana(9, { activa: false });
    expect(total(await vender({ fecha: SABADO, productoId: productoA }))).toBe(6);
  });
});

describeSiHayBase('3. El día se resuelve en hora de Perú', () => {
  it('domingo 23:30 de Lima paga tarifa de domingo, aunque en UTC ya sea lunes', async () => {
    await prisma.reglaComision.create({ data: { empresaId, diasSemana: '0,6', montoFijo: 9 } });
    const domingoDeNoche = new Date('2026-09-28T04:30:00Z');
    expect(total(await vender({ fecha: domingoDeNoche, productoId: productoA }))).toBe(18);
  });

  it('lunes 00:30 de Lima ya paga tarifa de lunes', async () => {
    await prisma.reglaComision.create({ data: { empresaId, diasSemana: '0,6', montoFijo: 9 } });
    const lunesTemprano = new Date('2026-09-28T05:30:00Z');
    expect(total(await vender({ fecha: lunesTemprano, productoId: productoA }))).toBe(6);
  });
});

describeSiHayBase('4. Una regla no se desborda a donde no corresponde', () => {
  it('una regla del producto A no toca al producto B', async () => {
    await prisma.reglaComision.create({
      data: { empresaId, productoId: productoA, diasSemana: '0,6', montoFijo: 9 },
    });
    expect(total(await vender({ fecha: SABADO, productoId: productoA }))).toBe(18);
    expect(total(await vender({ fecha: SABADO, productoId: productoB }))).toBe(6);
  });

  it('una regla de un vendedor no toca a otro', async () => {
    await prisma.reglaComision.create({
      data: { empresaId, vendedorId: vendedorId, montoFijo: 9 },
    });
    expect(total(await vender({ fecha: LUNES, productoId: productoA }))).toBe(18);
    expect(total(await vender({ fecha: LUNES, productoId: productoA, vendedor: otroVendedorId })))
      .toBe(6);
  });

  it('una regla de OTRA empresa no toca a esta', async () => {
    await prisma.reglaComision.create({
      data: { empresaId: otraEmpresaId, diasSemana: '0,6', montoFijo: 50 },
    });
    expect(total(await vender({ fecha: SABADO, productoId: productoA }))).toBe(6);
    await prisma.reglaComision.deleteMany({ where: { empresaId: otraEmpresaId } });
  });

  it('un vendedor de otra empresa no genera comisión', async () => {
    expect(await vender({ fecha: SABADO, productoId: productoA, vendedor: ajenoId })).toHaveLength(0);
  });
});

describeSiHayBase('5. Gana la regla más específica, también leyendo de la base', () => {
  it('producto+día le gana a solo-día', async () => {
    await prisma.reglaComision.create({ data: { empresaId, diasSemana: '0,6', montoFijo: 9 } });
    await prisma.reglaComision.create({
      data: { empresaId, productoId: productoA, diasSemana: '0,6', montoFijo: 12 },
    });
    expect(total(await vender({ fecha: SABADO, productoId: productoA }))).toBe(24);
    // El producto B, sin regla propia, se queda con la de solo-día.
    expect(total(await vender({ fecha: SABADO, productoId: productoB }))).toBe(18);
  });

  it('el lunes gana la de vendedor porque la de fin de semana no aplica', async () => {
    await prisma.reglaComision.create({ data: { empresaId, diasSemana: '0,6', montoFijo: 9 } });
    await prisma.reglaComision.create({ data: { empresaId, vendedorId, montoFijo: 7 } });
    expect(total(await vender({ fecha: LUNES, productoId: productoA }))).toBe(14);
  });
});

describeSiHayBase('6. Reglas por porcentaje', () => {
  it('cobra el porcentaje del precio unitario', async () => {
    await prisma.reglaComision.create({ data: { empresaId, diasSemana: '0,6', porcentaje: 10 } });
    // 10% de S/100 × 2 unidades.
    expect(total(await vender({ fecha: SABADO, productoId: productoA }))).toBe(20);
  });

  it('el monto fijo manda sobre el porcentaje si están los dos', async () => {
    await prisma.reglaComision.create({
      data: { empresaId, diasSemana: '0,6', montoFijo: 9, porcentaje: 50 },
    });
    expect(total(await vender({ fecha: SABADO, productoId: productoA }))).toBe(18);
  });

  it('redondea a dos decimales', async () => {
    await prisma.reglaComision.create({ data: { empresaId, diasSemana: '0,6', porcentaje: 3.33 } });
    // 3.33% de 33.33 × 3 = 3.3296...
    const [c] = await vender({ fecha: SABADO, productoId: productoA, precio: 33.33, cantidad: 3 });
    expect(Number(c.montoComision)).toBe(3.33);
  });
});

describeSiHayBase('7. Reglas mal cargadas no tumban la emisión', () => {
  it('una regla en cero cae a la comisión del producto', async () => {
    await prisma.reglaComision.create({ data: { empresaId, diasSemana: '0,6', montoFijo: 0 } });
    expect(total(await vender({ fecha: SABADO, productoId: productoA }))).toBe(6);
  });

  it('una regla sin monto ni porcentaje cae a la del producto', async () => {
    await prisma.reglaComision.create({ data: { empresaId, diasSemana: '0,6' } });
    expect(total(await vender({ fecha: SABADO, productoId: productoA }))).toBe(6);
  });

  it('días con basura se leen como "todos los días"', async () => {
    await prisma.reglaComision.create({ data: { empresaId, diasSemana: 'sabado', montoFijo: 9 } });
    expect(total(await vender({ fecha: LUNES, productoId: productoA }))).toBe(18);
  });
});

describeSiHayBase('8. La pantalla: fijar y quitar la comisión de fin de semana', () => {
  it('guarda, lee y actualiza', async () => {
    await servicio.fijarComisionFinDeSemana(empresaId, productoA, 9);
    expect(await servicio.comisionFinDeSemana(empresaId, productoA)).toBe(9);

    await servicio.fijarComisionFinDeSemana(empresaId, productoA, 12);
    expect(await servicio.comisionFinDeSemana(empresaId, productoA)).toBe(12);
    // No debe dejar dos reglas compitiendo.
    expect(await prisma.reglaComision.count({ where: { empresaId, productoId: productoA } })).toBe(1);
  });

  it('vaciar el campo borra la regla, no la deja en cero', async () => {
    await servicio.fijarComisionFinDeSemana(empresaId, productoA, 9);
    await servicio.fijarComisionFinDeSemana(empresaId, productoA, null);
    expect(await servicio.comisionFinDeSemana(empresaId, productoA)).toBeNull();
    // Dejarla activa en cero haría que el fin de semana no pague nada.
    expect(total(await vender({ fecha: SABADO, productoId: productoA }))).toBe(6);
  });

  it('no deja tocar un producto de otra empresa', async () => {
    const ajeno = await prisma.producto.findFirst({ where: { empresaId } });
    await servicio.fijarComisionFinDeSemana(otraEmpresaId, ajeno!.id, 99);
    expect(await prisma.reglaComision.count({ where: { empresaId: otraEmpresaId } })).toBe(0);
  });

  it('lo guardado por la pantalla es lo que cobra la venta', async () => {
    await servicio.fijarComisionFinDeSemana(empresaId, productoA, 9);
    expect(total(await vender({ fecha: SABADO, productoId: productoA }))).toBe(18);
    expect(total(await vender({ fecha: LUNES, productoId: productoA }))).toBe(6);
  });
});

describeSiHayBase('9. El período de liquidación también es hora de Perú', () => {
  it('una venta del 30 a las 23:00 de Lima se liquida en setiembre, no en octubre', async () => {
    // 2026-10-01 04:00 UTC = 30/09 23:00 en Lima. Con el reloj del servidor
    // esta comisión aparecía en la liquidación del mes siguiente.
    const ultimaNoche = new Date('2026-10-01T04:00:00Z');
    const comprobante = await prisma.comprobante.create({
      data: {
        tipoDoc: '03', serie: 'B001', correlativo: correlativo++, fechaEmision: ultimaNoche,
        formaPagoTipo: 'Contado', formaPagoMoneda: 'PEN', tipoMoneda: 'PEN',
        mtoOperGravadas: 0, mtoIGV: 0, valorVenta: 0, totalImpuestos: 0,
        subTotal: 0, mtoImpVenta: 200, clienteId, empresaId,
      },
      select: { id: true },
    });
    await servicio.registrarComisionesDesdeComprobante({
      comprobanteId: comprobante.id, empresaId, vendedorId, fechaEmision: ultimaNoche,
      detalles: [{ productoId: productoA, descripcion: 'x', cantidad: 2, mtoPrecioUnitario: 100 }],
    });
    const [c] = await prisma.comisionVendedor.findMany({
      where: { comprobanteId: comprobante.id }, select: { mes: true, anio: true },
    });
    expect({ mes: c.mes, anio: c.anio }).toEqual({ mes: 9, anio: 2026 });
  });

  it('el 1ro a las 00:30 de Lima ya se liquida en octubre', async () => {
    const primeroTemprano = new Date('2026-10-01T05:30:00Z');
    const comprobante = await prisma.comprobante.create({
      data: {
        tipoDoc: '03', serie: 'B001', correlativo: correlativo++, fechaEmision: primeroTemprano,
        formaPagoTipo: 'Contado', formaPagoMoneda: 'PEN', tipoMoneda: 'PEN',
        mtoOperGravadas: 0, mtoIGV: 0, valorVenta: 0, totalImpuestos: 0,
        subTotal: 0, mtoImpVenta: 200, clienteId, empresaId,
      },
      select: { id: true },
    });
    await servicio.registrarComisionesDesdeComprobante({
      comprobanteId: comprobante.id, empresaId, vendedorId, fechaEmision: primeroTemprano,
      detalles: [{ productoId: productoA, descripcion: 'x', cantidad: 2, mtoPrecioUnitario: 100 }],
    });
    const [c] = await prisma.comisionVendedor.findMany({
      where: { comprobanteId: comprobante.id }, select: { mes: true, anio: true },
    });
    expect({ mes: c.mes, anio: c.anio }).toEqual({ mes: 10, anio: 2026 });
  });
});
