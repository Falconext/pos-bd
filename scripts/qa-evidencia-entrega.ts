/**
 * D3 — QA funcional de la evidencia de entrega contra Postgres de verdad.
 *
 * Los tests unitarios prueban las reglas con un Prisma de mentira. Lo que NO
 * pueden probar es justo lo que más se equivoca: cómo se comporta la consulta
 * real. En particular `evidencias: { none: { anuladaEn: null } }` — que una
 * evidencia ANULADA no tape el hueco — y que borrar el despacho se lleve sus
 * evidencias en cascada en vez de dejar filas colgadas.
 *
 *   export DATABASE_URL=postgresql://postgres:developer@localhost:5432/sistema_mype
 *   npx ts-node --transpile-only scripts/qa-evidencia-entrega.ts
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { EvidenciaEntregaService } from '../src/envio-despacho/evidencia-entrega.service';

/**
 * La empresa la elige el propio script: en la BD local de QA no siempre hay
 * comprobantes de Hierba Sana, y lo que se prueba acá es la consulta, no el
 * dato de un cliente. Se puede forzar con el primer argumento.
 */
async function elegirEmpresa(prisma: PrismaService): Promise<number> {
  const forzada = Number(process.argv[2]);
  if (forzada) return forzada;
  const [fila] = await prisma.$queryRaw<{ empresaId: number }[]>`
    SELECT "empresaId" FROM "Comprobante"
    GROUP BY "empresaId" HAVING COUNT(*) >= 2
    ORDER BY COUNT(*) DESC LIMIT 1`;
  if (!fila) throw new Error('Ninguna empresa local tiene 2 comprobantes.');
  return Number(fila.empresaId);
}

let fallos = 0;
const ok = (cond: boolean, texto: string, detalle = '') => {
  console.log(`${cond ? '✔' : '✗'} ${texto}${detalle ? ` — ${detalle}` : ''}`);
  if (!cond) fallos++;
};

/** S3 de mentira: no se necesita AWS para probar la lógica contra la BD. */
const s3 = {
  isEnabled: () => true,
  generateEvidenciaEntregaKey: (e: number, d: number) =>
    `entregas/empresa-${e}/despacho-${d}/evidencia-${Date.now()}.webp`,
  uploadImage: async (_b: Buffer, key: string) => `https://s3-falso/${key}`,
} as never;

const foto = () =>
  ({
    originalname: 'entrega.jpg',
    mimetype: 'image/jpeg',
    buffer: Buffer.from('bytes'),
    size: 5,
  }) as never;

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL no apunta a localhost. QA solo en local.');
  }
  const prisma = new PrismaService();
  const EMPRESA_ID = await elegirEmpresa(prisma);
  console.log(`Empresa de prueba: ${EMPRESA_ID}\n`);

  // Despachos marcados ENTREGADO que cumplen de verdad.
  const despachos = { update: async () => ({}) } as never;
  const srv = new EvidenciaEntregaService(prisma, s3, despachos);

  // ── Preparar: dos comprobantes de la empresa con despacho ENTREGADO ──
  const comprobantes = await prisma.comprobante.findMany({
    where: { empresaId: EMPRESA_ID },
    select: { id: true, serie: true, correlativo: true },
    take: 2,
    orderBy: { id: 'desc' },
  });
  if (comprobantes.length < 2) {
    throw new Error(
      `La empresa ${EMPRESA_ID} necesita 2 comprobantes para este QA (tiene ${comprobantes.length}).`,
    );
  }
  const [conFoto, sinFoto] = comprobantes;

  const creados: number[] = [];
  for (const c of comprobantes) {
    const d = await prisma.envioDespacho.upsert({
      where: { comprobanteId: c.id },
      create: {
        comprobanteId: c.id,
        estado: 'ENTREGADO',
        entregadoEn: new Date(),
        transportista: 'PROPIOS',
      },
      update: { estado: 'ENTREGADO', entregadoEn: new Date() },
      select: { id: true },
    });
    creados.push(d.id);
  }
  await prisma.evidenciaEntrega.deleteMany({
    where: { despachoId: { in: creados } },
  });

  // ── 1. Registrar ──
  const alta = await srv.registrar(conFoto.id, EMPRESA_ID, [foto()], {}, {
    id: 1,
    nombre: 'QA',
    rol: 'ADMIN_EMPRESA',
  });
  ok(alta.registradas === 1, 'registra la evidencia en la BD');
  ok(
    alta.evidencias.length === 1 &&
      alta.evidencias[0].url.startsWith('https://s3-falso/entregas/'),
    'la devuelve con su URL',
  );

  // ── 2. El hueco: solo el que NO tiene foto ──
  let hueco = await srv.entregasSinEvidencia(EMPRESA_ID, {});
  let ids = hueco.entregas.map((e) => e.comprobanteId);
  ok(
    !ids.includes(conFoto.id),
    'el entregado CON foto no figura como hueco',
    `comprobante ${conFoto.id}`,
  );
  ok(
    ids.includes(sinFoto.id),
    'el entregado SIN foto sí figura',
    `comprobante ${sinFoto.id}`,
  );

  // ── 3. Una evidencia anulada NO tapa el hueco ──
  // Es el caso que un `none: {}` sin condición dejaría pasar: el despacho
  // seguiría teniendo una fila, pero anulada, y el negocio creería estar
  // cubierto cuando no tiene nada que mostrar.
  const laUnica = alta.evidencias[0].id;
  await srv.anular(laUnica, EMPRESA_ID, { id: 1, nombre: 'QA', rol: 'ADMIN_EMPRESA' });

  const tras = await srv.listar(conFoto.id, EMPRESA_ID);
  ok(tras.length === 0, 'anulada deja de listarse');
  const fila = await prisma.evidenciaEntrega.findUnique({
    where: { id: laUnica },
    select: { anuladaEn: true, anuladaPor: true },
  });
  ok(
    !!fila?.anuladaEn && fila.anuladaPor === 'QA',
    'pero la fila sigue ahí con quién la anuló',
    `anuladaPor=${fila?.anuladaPor}`,
  );

  hueco = await srv.entregasSinEvidencia(EMPRESA_ID, {});
  ids = hueco.entregas.map((e) => e.comprobanteId);
  ok(
    ids.includes(conFoto.id),
    'con la única evidencia anulada, el despacho vuelve a contar como hueco',
  );

  // ── 4. El rango de fechas filtra ──
  // El día de HOY en Lima, no en UTC: después de las 7 p.m. `toISOString()`
  // ya devuelve el día siguiente y el filtro buscaría mañana.
  const hoy = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Lima',
  });
  const dentro = await srv.entregasSinEvidencia(EMPRESA_ID, {
    desde: hoy,
    hasta: hoy,
  });
  ok(dentro.total > 0, 'filtrando por hoy aparecen las de hoy');
  const fuera = await srv.entregasSinEvidencia(EMPRESA_ID, {
    desde: '2020-01-01',
    hasta: '2020-01-02',
  });
  ok(
    fuera.total === 0,
    'filtrando por un rango viejo no aparece ninguna',
    `total=${fuera.total}`,
  );

  // ── 5. Aislamiento entre empresas ──
  const otra = await prisma.empresa.findFirst({
    where: { id: { not: EMPRESA_ID } },
    select: { id: true },
  });
  if (otra) {
    const ajena = await srv.entregasSinEvidencia(otra.id, {});
    ok(
      !ajena.entregas.some((e) => comprobantes.some((c) => c.id === e.comprobanteId)),
      'otra empresa no ve estos despachos',
    );
    let bloqueado = false;
    try {
      await srv.listar(conFoto.id, otra.id);
    } catch {
      bloqueado = true;
    }
    ok(bloqueado, 'pedir la evidencia de otra empresa no devuelve nada');
  }

  // ── 6. Cascada: borrar el despacho se lleva sus evidencias ──
  await prisma.evidenciaEntrega.deleteMany({ where: { despachoId: creados[0] } });
  await srv.registrar(conFoto.id, EMPRESA_ID, [foto(), foto()], {}, {
    id: 1,
    nombre: 'QA',
    rol: 'ADMIN_EMPRESA',
  });
  const antes = await prisma.evidenciaEntrega.count({
    where: { despachoId: creados[0] },
  });
  await prisma.envioDespacho.delete({ where: { id: creados[0] } });
  const despues = await prisma.evidenciaEntrega.count({
    where: { despachoId: creados[0] },
  });
  ok(
    antes === 2 && despues === 0,
    'borrar el despacho se lleva sus evidencias (sin filas huérfanas)',
    `${antes} → ${despues}`,
  );

  // ── Limpiar ──
  await prisma.envioDespacho.deleteMany({ where: { id: { in: creados } } });

  console.log(
    fallos === 0 ? '\nQA D3: todo OK.' : `\nQA D3: ${fallos} fallo(s).`,
  );
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
