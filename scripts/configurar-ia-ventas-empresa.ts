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

async function main() {
  const empresaId = Number(process.argv[2]);
  const plantilla = process.argv[3];
  if (!empresaId) {
    throw new Error(
      'Uso: configurar-ia-ventas-empresa.ts <empresaId> <plantilla|--ver>',
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
