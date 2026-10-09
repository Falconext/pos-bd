/**
 * QA funcional de la retención: servicio real, base real.
 *
 * Lo que se prueba acá y no en los unit tests: que la marca del cliente
 * SOBREVIVA el viaje formulario → DTO → servicio → base → lectura. Es
 * exactamente donde ya nos mordió dos veces (precios mayorista y código de
 * producto se perdían por faltar en la lista blanca del DTO).
 *
 * Se corre contra una base DESECHABLE, nunca contra producción:
 *
 *   createdb qa_retencion && psql -d qa_retencion -c 'CREATE EXTENSION vector'
 *   DATABASE_URL=postgresql://USUARIO:CLAVE@localhost:5432/qa_retencion \
 *     npx prisma db push --skip-generate --accept-data-loss
 *   DATABASE_URL=postgresql://USUARIO:CLAVE@localhost:5432/qa_retencion \
 *     npx ts-node --transpile-only -P tsconfig.json scripts/qa-retencion.ts
 */
import { PrismaClient } from '@prisma/client';
import { ClienteService } from '../src/cliente/cliente.service';
import { aplicaRetencion, calcularRetencion } from '../src/comprobante/retencion';

const prisma = new PrismaClient();
const service = new ClienteService(prisma as any);

let ok = 0, fallo = 0;
const check = (nombre: string, cond: boolean, detalle = '') => {
  if (cond) { ok++; console.log('  ✓', nombre); }
  else { fallo++; console.log('  ✗', nombre, detalle); }
};

(async () => {
  const plan = await prisma.plan.create({ data: { nombre: 'QA' } });
  const empresa = await prisma.empresa.create({
    data: {
      ruc: '20602150756', razonSocial: 'IMPORTACIONES KAWAMOTO PERU E.I.R.L.',
      direccion: 'AV. ARGENTINA 327', planId: plan.id,
      fechaActivacion: new Date(), fechaExpiracion: new Date(Date.now() + 9e10),
    },
  });

  console.log('\n1) El cliente agente de retención se guarda');
  const agente: any = await service.crear({
    nombre: 'EMPRESA MINERA SOL DE ORO S.R.L.', tipoDoc: 'RUC',
    nroDoc: '20454995962', direccion: 'AV. FRANKLIN PEASE', empresaId: empresa.id,
    ubigeo: '040101', departamento: 'AREQUIPA', provincia: 'AREQUIPA',
    distrito: 'AREQUIPA', persona: 'CLIENTE', esAgenteRetencion: true,
  } as any);
  const leido: any = await prisma.cliente.findUnique({ where: { id: agente.id } });
  check('queda marcado en la base', leido.esAgenteRetencion === true,
        `→ quedó ${leido.esAgenteRetencion}`);

  console.log('\n2) Un cliente común NO queda marcado');
  const comun: any = await service.crear({
    nombre: 'CLIENTE COMUN S.A.C.', tipoDoc: 'RUC', nroDoc: '20123456789',
    direccion: 'CALLE X', empresaId: empresa.id, ubigeo: '150101',
    departamento: 'LIMA', provincia: 'LIMA', distrito: 'LIMA', persona: 'CLIENTE',
  } as any);
  const leidoComun: any = await prisma.cliente.findUnique({ where: { id: comun.id } });
  check('arranca en false', leidoComun.esAgenteRetencion === false,
        `→ quedó ${leidoComun.esAgenteRetencion}`);

  console.log('\n3) Editar otro dato NO apaga la marca');
  await service.actualizar({
    id: agente.id, empresaId: empresa.id, nombre: 'SOL DE ORO S.R.L. (NUEVO NOMBRE)',
  });
  const trasEditar: any = await prisma.cliente.findUnique({ where: { id: agente.id } });
  check('sigue marcado tras editar el nombre', trasEditar.esAgenteRetencion === true,
        `→ quedó ${trasEditar.esAgenteRetencion}`);
  check('el nombre sí se actualizó', trasEditar.nombre.includes('NUEVO NOMBRE'));

  console.log('\n4) Se puede apagar a propósito');
  await service.actualizar({
    id: agente.id, empresaId: empresa.id, esAgenteRetencion: false,
  } as any);
  const apagado: any = await prisma.cliente.findUnique({ where: { id: agente.id } });
  check('queda en false cuando se desmarca', apagado.esAgenteRetencion === false,
        `→ quedó ${apagado.esAgenteRetencion}`);
  await service.actualizar({
    id: agente.id, empresaId: empresa.id, esAgenteRetencion: true,
  } as any);

  console.log('\n5) De la base al monto: la decisión del POS');
  const desdeBd: any = await prisma.cliente.findUnique({ where: { id: agente.id } });
  const comunBd: any = await prisma.cliente.findUnique({ where: { id: comun.id } });

  const caso = (cli: any, total: number, tipoDoc = '01') =>
    aplicaRetencion({
      tipoDoc, total, clienteEsAgenteRetencion: cli.esAgenteRetencion,
    });

  check('al agente, factura de S/3,100 → retiene', caso(desdeBd, 3100));
  check('al agente le retiene S/93.00', calcularRetencion(3100) === 93);
  check('al cliente común, la MISMA factura → no retiene', caso(comunBd, 3100) === false);
  check('al agente, factura de S/700 exactos → no retiene', caso(desdeBd, 700) === false);
  check('al agente, factura de S/700.01 → sí retiene', caso(desdeBd, 700.01));
  check('al agente, pero en BOLETA (03) → no retiene', caso(desdeBd, 3100, '03') === false);

  console.log(`\n═══ ${ok} pasaron, ${fallo} fallaron ═══`);
  await prisma.$disconnect();
  process.exit(fallo ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR:', e?.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
