/**
 * Escribe la configuración comercial de la IA de Ventas de una empresa.
 *
 * Hace falta porque los valores de Hierba Sana dejaron de ser el defecto del
 * sistema: una empresa sin configurar ya no hereda las zonas, tarifas ni
 * descuentos de otra —antes sí, y eso hacía que cualquier tienda de la
 * plataforma descontara S/ 10 a S/ 30 por pedido sin que su dueño lo supiera.
 *
 * La contracara es que ahora hay que configurar a cada cliente, y esto es la
 * herramienta. Sin zonas, la IA no cotiza: deriva a un asesor.
 *
 *   npx ts-node --transpile-only scripts/configurar-ia-ventas-empresa.ts 89 hierba-sana
 *   npx ts-node --transpile-only scripts/configurar-ia-ventas-empresa.ts 89 --ver
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { CONFIG_ENVIO_HIERBA_SANA } from '../src/leads/envio-zonas';
import { HORARIO_POR_DEFECTO } from '../src/leads/validaciones-pedido';
import { REGLAS_HIERBA_SANA } from '../src/leads/reglas-descuento';

/** Los juegos de configuración que ya están escritos en código. */
const PLANTILLAS: Record<string, Record<string, unknown>> = {
  'hierba-sana': {
    envio: CONFIG_ENVIO_HIERBA_SANA,
    horario: HORARIO_POR_DEFECTO,
    descuento: REGLAS_HIERBA_SANA,
    asesor: 'Claudio',
    descargoLegal:
      'Los productos naturales son un complemento y no reemplazan un tratamiento médico. Ante cualquier condición de salud, consulta a tu médico.',
  },
};

/** Todas las empresas con la IA encendida y el estado de su configuración. */
async function listar(prisma: PrismaService) {
  const empresas = await prisma.empresa.findMany({
    where: { iaVentasActiva: true },
    select: {
      id: true,
      nombreComercial: true,
      razonSocial: true,
      iaVentasConfigJson: true,
    },
    orderBy: { id: 'asc' },
  });
  console.log(`Empresas con la IA de Ventas encendida: ${empresas.length}\n`);
  for (const e of empresas) {
    const c = (e.iaVentasConfigJson ?? {}) as Record<string, any>;
    const zonas = c.envio?.zonas?.length ?? 0;
    const tramos = c.descuento?.tramos?.length ?? 0;
    const marca = zonas > 0 ? '✔' : '⚠';
    console.log(
      `${marca} ${String(e.id).padStart(4)}  ${(e.nombreComercial ?? e.razonSocial ?? '').slice(0, 28).padEnd(28)}` +
        ` zonas:${String(zonas).padStart(2)}  tramos:${String(tramos).padStart(2)}` +
        `  asesor:${c.asesor ? 'sí' : 'no '}  descargo:${c.descargoLegal ? 'sí' : 'no'}`,
    );
  }
  const sin = empresas.filter(
    (e) => !((e.iaVentasConfigJson as any)?.envio?.zonas?.length),
  );
  if (sin.length) {
    console.log(
      `\n⚠ ${sin.length} sin zonas de envío: su IA no cotiza, deriva a un asesor.`,
    );
  }
}

async function main() {
  const empresaId = Number(process.argv[2]);
  const plantilla = process.argv[3];
  if (process.argv[2] === '--listar') {
    const prisma = new PrismaService();
    await listar(prisma);
    await prisma.$disconnect();
    return;
  }
  if (!empresaId) {
    throw new Error(
      'Uso: configurar-ia-ventas-empresa.ts <empresaId> <plantilla|--ver|--listar>',
    );
  }

  const prisma = new PrismaService();
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: {
      id: true,
      nombreComercial: true,
      razonSocial: true,
      iaVentasActiva: true,
      iaVentasConfigJson: true,
      slugTienda: true,
      whatsappTienda: true,
    },
  });
  if (!empresa) throw new Error(`No existe la empresa ${empresaId}.`);

  const nombre = empresa.nombreComercial ?? empresa.razonSocial;
  const actual = (empresa.iaVentasConfigJson ?? {}) as Record<string, unknown>;

  if (plantilla === '--ver' || !plantilla) {
    console.log(`Empresa ${empresa.id} — ${nombre}`);
    console.log(`  IA de Ventas: ${empresa.iaVentasActiva ? 'activa' : 'apagada'}`);
    const envio = actual.envio as { zonas?: unknown[] } | undefined;
    const desc = actual.descuento as { tramos?: unknown[] } | undefined;
    console.log(`  zonas de envío: ${envio?.zonas?.length ?? 0}`);
    console.log(`  tramos de descuento: ${desc?.tramos?.length ?? 0}`);
    console.log(`  asesor: ${actual.asesor ?? '(sin nombre)'}`);
    console.log(`  descargo legal: ${actual.descargoLegal ? 'sí' : 'NO'}`);
    // Los dos datos que deciden si la tienda y el paso del carrito al chat
    // están de verdad en vivo para este cliente.
    console.log(`  tienda pública: ${empresa.slugTienda ?? 'NO publicada'}`);
    console.log(
      `  WhatsApp de la tienda: ${empresa.whatsappTienda ?? 'VACÍO — el carrito no ofrece "Pedir por WhatsApp"'}`,
    );
    if (!envio?.zonas?.length) {
      console.log(
        '\n  ⚠ Sin zonas de envío la IA NO cotiza: deriva a un asesor.',
      );
      console.log(
        `    Para configurarla: ...configurar-ia-ventas-empresa.ts ${empresaId} <plantilla>`,
      );
      console.log(`    Plantillas: ${Object.keys(PLANTILLAS).join(', ')}`);
    }
    await prisma.$disconnect();
    return;
  }

  const nueva = PLANTILLAS[plantilla];
  if (!nueva) {
    throw new Error(
      `Plantilla "${plantilla}" desconocida. Hay: ${Object.keys(PLANTILLAS).join(', ')}`,
    );
  }

  // Se fusiona sobre lo que ya hubiera: si alguien ajustó el nombre del asesor
  // a mano, correr esto no se lo pisa salvo que la plantilla lo traiga.
  const fusionada = { ...actual, ...nueva };
  await prisma.empresa.update({
    where: { id: empresaId },
    data: { iaVentasConfigJson: fusionada as never },
  });

  const envio = nueva.envio as { zonas: unknown[] };
  const desc = nueva.descuento as { tramos: unknown[] };
  console.log(`✔ Empresa ${empresa.id} — ${nombre}`);
  console.log(`  plantilla aplicada: ${plantilla}`);
  console.log(`  zonas de envío: ${envio.zonas.length}`);
  console.log(`  tramos de descuento: ${desc.tramos.length}`);
  console.log(`  asesor: ${nueva.asesor}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
