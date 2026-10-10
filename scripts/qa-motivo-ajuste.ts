/**
 * QA funcional: el motivo del ajuste de stock llega al kardex.
 *
 * Pedido de DEMENVER: quitar nueve unidades y poder decir POR QUÉ. Se usa el
 * `actualizar` REAL del servicio de productos, que es el que dispara el
 * movimiento, contra una base DESECHABLE (nunca producción).
 */
import { PrismaClient } from '@prisma/client';
import { KardexService } from '../src/kardex/kardex.service';
import { ProductoService } from '../src/producto/producto.service';

const prisma = new PrismaClient();
const kardex = new KardexService(prisma as any, null as any, null as any);
const productos = new ProductoService(prisma as any, kardex as any, null as any, null as any);

let ok = 0, fallo = 0;
const check = (n: string, cond: boolean, d = '') => {
  if (cond) { ok++; console.log('  ✓', n); } else { fallo++; console.log('  ✗', n, d); }
};

(async () => {
  const plan = await prisma.plan.create({ data: { nombre: 'QA' } });
  const empresa = await prisma.empresa.create({
    data: { ruc: '20999999999', razonSocial: 'DEMENVER QA', direccion: 'AV QA',
            planId: plan.id, fechaActivacion: new Date(), fechaExpiracion: new Date(Date.now() + 9e10) },
  });
  const sede = await prisma.sede.create({ data: { empresaId: empresa.id, nombre: 'Zapallal', esPrincipal: true } });
  const um = await prisma.unidadMedida.create({ data: { codigo: 'NIU', nombre: 'Unidad' } });
  const usuario = await prisma.usuario.create({
    data: { nombre: 'AZUCENA SANCHEZ MAURICIO', email: 'qa@qa.test', password: 'x', dni: '00000001', celular: '999999999',
            rol: 'ADMIN_EMPRESA', empresaId: empresa.id },
  });
  const prod = await prisma.producto.create({
    data: { codigo: 'AUD-01', descripcion: 'Audifono Sound By Camara', empresaId: empresa.id,
            unidadMedidaId: um.id, tipoAfectacionIGV: '10', precioUnitario: 13.5,
            valorUnitario: 11.44, costoPromedio: 7.2, estado: 'ACTIVO' },
  });
  await prisma.productoStock.create({ data: { productoId: prod.id, sedeId: sede.id, stock: 41 } });

  const ultimoMovimiento = async () => prisma.movimientoKardex.findFirst({
    where: { productoId: prod.id }, orderBy: { id: 'desc' },
  });

  console.log('\n1) SALIDA por merma: 41 → 32');
  await productos.actualizar({
    id: prod.id, empresaId: empresa.id, sedeId: sede.id, stock: 32,
    motivoAjusteStock: 'MERMA', detalleAjusteStock: 'se cayeron de la repisa en el traslado',
  } as any, usuario.id);
  let m: any = await ultimoMovimiento();
  console.log(`     concepto   : ${m?.concepto}`);
  console.log(`     observación: ${m?.observacion}`);
  check('queda registrado como SALIDA', m?.tipoMovimiento === 'SALIDA');
  check('el concepto dice el motivo, no "ajuste manual"',
        String(m?.concepto).startsWith('Merma (producto roto o dañado)'),
        `→ ${m?.concepto}`);
  check('el detalle escrito a mano se guarda',
        m?.observacion === 'se cayeron de la repisa en el traslado', `→ ${m?.observacion}`);
  check('la observación ya NO repite el stock anterior/nuevo',
        !String(m?.observacion ?? '').includes('Stock anterior'));
  check('queda quién lo hizo', m?.usuarioId === usuario.id);

  console.log('\n2) INGRESO por unidad encontrada: 32 → 33');
  await productos.actualizar({
    id: prod.id, empresaId: empresa.id, sedeId: sede.id, stock: 33,
    motivoAjusteStock: 'ENCONTRADO', detalleAjusteStock: 'vino una de más en la caja',
  } as any, usuario.id);
  m = await ultimoMovimiento();
  console.log(`     concepto   : ${m?.concepto}`);
  check('queda como INGRESO', m?.tipoMovimiento === 'INGRESO');
  check('con su motivo', String(m?.concepto).startsWith('Encontrado en inventario'));
  check('con signo +', String(m?.concepto).includes('(+1)'));

  console.log('\n3) Sin motivo (compatibilidad: otros flujos no lo mandan)');
  await productos.actualizar({ id: prod.id, empresaId: empresa.id, sedeId: sede.id, stock: 30 } as any, usuario.id);
  m = await ultimoMovimiento();
  console.log(`     concepto   : ${m?.concepto}`);
  check('sigue registrándose el movimiento', m?.tipoMovimiento === 'SALIDA');
  check('con el texto de siempre', String(m?.concepto).includes('Ajuste manual de stock desde inventario'));

  console.log('\n4) Filtrar el historial por motivo (el "apartado de mermas")');
  const porMotivo = async (etiqueta: string) => prisma.movimientoKardex.count({
    where: { empresaId: empresa.id, concepto: { contains: etiqueta, mode: 'insensitive' } },
  });
  const mermas = await porMotivo('Merma (producto roto o dañado)');
  const encontrados = await porMotivo('Encontrado en inventario');
  const todos = await prisma.movimientoKardex.count({ where: { empresaId: empresa.id } });
  console.log(`     movimientos totales: ${todos} · mermas: ${mermas} · encontrados: ${encontrados}`);
  check('filtrando por "Merma" sale solo la merma', mermas === 1, `→ ${mermas}`);
  check('filtrando por "Encontrado" sale solo ese', encontrados === 1, `→ ${encontrados}`);
  check('el ajuste sin motivo no se cuela en ningún filtro', todos === 3 && mermas + encontrados === 2);

  console.log('\n5) REPORTE DE MERMAS · tiene que cuadrar con lo de arriba');
  const rep: any = await kardex.reporteMermas(empresa.id, {});
  console.log(`     unidades perdidas : ${rep.resumen.unidadesPerdidas}`);
  console.log(`     valor perdido     : S/${rep.resumen.valorPerdido.toFixed(2)}`);
  console.log(`     productos afectados: ${rep.resumen.productosAfectados}`);
  console.log(`     movimientos con motivo: ${rep.resumen.movimientosConMotivo}`);
  for (const m of rep.porMotivo)
    console.log(`       · ${m.etiqueta.padEnd(34)} ${m.unidades} und · S/${m.valor.toFixed(2)} · ${m.esPerdida ? 'PÉRDIDA' : 'corrección'}`);

  // Las 9 unidades de merma del paso 1, al costo de 7.20 que tiene el producto.
  const esperado = Math.round(9 * 7.2 * 100) / 100;
  check('cuenta las 9 unidades de la merma', rep.resumen.unidadesPerdidas === 9,
        `→ ${rep.resumen.unidadesPerdidas}`);
  check(`valora la pérdida en S/${esperado.toFixed(2)}`,
        Math.abs(rep.resumen.valorPerdido - esperado) < 0.02,
        `→ S/${rep.resumen.valorPerdido}`);
  check('la unidad ENCONTRADA no se cuenta como pérdida',
        rep.porMotivo.find((m: any) => m.codigo === 'ENCONTRADO')?.esPerdida === false);
  check('pero sí aparece en el desglose por motivo', rep.porMotivo.length === 2,
        `→ ${rep.porMotivo.length} motivos`);
  check('el ajuste SIN motivo no entra al reporte',
        rep.resumen.movimientosConMotivo === 2, `→ ${rep.resumen.movimientosConMotivo}`);
  check('un solo producto afectado', rep.resumen.productosAfectados === 1);
  check('el detalle conserva lo que se escribió a mano',
        rep.detalle.some((d: any) => d.detalle === 'se cayeron de la repisa en el traslado'));
  check('y quién lo hizo', rep.detalle.every((d: any) => d.responsable === 'AZUCENA SANCHEZ MAURICIO'));

  console.log(`\n═══ ${ok} pasaron, ${fallo} fallaron ═══`);
  await prisma.$disconnect();
  process.exit(fallo ? 1 : 0);
})().catch(async (e) => { console.error('ERROR:', e?.message || e); await prisma.$disconnect(); process.exit(1); });
