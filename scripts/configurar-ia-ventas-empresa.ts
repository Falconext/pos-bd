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
 *   npx ts-node --transpile-only scripts/configurar-ia-ventas-empresa.ts 89 --limpiar-internos
 *   npx ts-node --transpile-only scripts/configurar-ia-ventas-empresa.ts 89 --borrar-chats
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { CONFIG_ENVIO_HIERBA_SANA } from '../src/leads/envio-zonas';
import { HORARIO_POR_DEFECTO } from '../src/leads/validaciones-pedido';
import { REGLAS_HIERBA_SANA } from '../src/leads/reglas-descuento';
import { esNumeroInterno, numerosInternos } from '../src/leads/numeros-internos';
import { LeadsService } from '../src/leads/leads.service';

/** Los juegos de configuración que ya están escritos en código. */
const PLANTILLAS: Record<string, Record<string, unknown>> = {
  'hierba-sana': {
    envio: CONFIG_ENVIO_HIERBA_SANA,
    horario: HORARIO_POR_DEFECTO,
    descuento: REGLAS_HIERBA_SANA,
    asesor: 'Claudio',
    // Decidido por el negocio el 10-10: la IA los da sola cuando hay
    // adelanto, sin esperar a un asesor.
    mediosPago:
      'Yape: 955 947 892 · Cuenta BCP: 191 99295336017 (titular: Edwing Tony Cayo Huerta)',
    descargoLegal:
      'Los productos naturales son un complemento y no reemplazan un tratamiento médico. Ante cualquier condición de salud, consulta a tu médico.',
    // A quién avisarle por WhatsApp apenas la IA deriva. Es Tony Cayo, el
    // supervisor de ventas, y coincide con el celular del administrador.
    supervisorTelefono: '955947892',
    // Sus números de prueba: escriben al bot haciéndose pasar por clientes y
    // no deben aparecer en el embudo. "StiloColecta" es uno de ellos.
    numerosInternos: ['51919755320'],
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

  if (plantilla === '--borrar-chats') {
    await borrarChats(prisma, empresaId);
    return;
  }

  if (plantilla === '--limpiar-internos') {
    await limpiarInternos(prisma, empresaId);
    return;
  }

  if (plantilla === '--ver' || !plantilla) {
    console.log(`Empresa ${empresa.id} — ${nombre}`);
    console.log(`  IA de Ventas: ${empresa.iaVentasActiva ? 'activa' : 'apagada'}`);
    const envio = actual.envio as { zonas?: unknown[] } | undefined;
    const desc = actual.descuento as { tramos?: unknown[] } | undefined;
    console.log(`  zonas de envío: ${envio?.zonas?.length ?? 0}`);
    console.log(`  tramos de descuento: ${desc?.tramos?.length ?? 0}`);
    console.log(`  asesor: ${actual.asesor ?? '(sin nombre)'}`);
    console.log(
      `  medios de pago: ${actual.mediosPago ?? 'NO configurados — la IA no los puede dar'}`,
    );
    console.log(`  descargo legal: ${actual.descargoLegal ? 'sí' : 'NO'}`);
    console.log(
      `  avisos de derivación a: ${actual.supervisorTelefono ?? 'los administradores (sin supervisor configurado)'}`,
    );
    const internos = (actual.numerosInternos as string[] | undefined) ?? [];
    console.log(
      `  números de prueba fuera del embudo: ${internos.length ? internos.join(', ') : 'ninguno (solo los celulares de los admins)'}`,
    );
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
  console.log(`  medios de pago: ${nueva.mediosPago ? 'configurados' : 'no'}`);
  await prisma.$disconnect();
}

/**
 * Saca del embudo las pruebas del propio negocio.
 *
 * De aquí en adelante no vuelven a entrar —el procesador ya no les crea
 * prospecto— pero las que entraron antes siguen ahí. En Hierba Sana eran dos
 * de tres tarjetas del tablero, con puntajes de 82 y 96.
 *
 * Borra el PROSPECTO, no la conversación: el chat de prueba se puede seguir
 * leyendo, lo que desaparece es la tarjeta que competía por la atención del
 * vendedor.
 */
async function limpiarInternos(prisma: PrismaService, empresaId: number) {
  const [admins, empresa] = await Promise.all([
    prisma.usuario.findMany({
      where: { empresaId, rol: 'ADMIN_EMPRESA' },
      select: { celular: true },
    }),
    prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { iaVentasConfigJson: true },
    }),
  ]);
  const cfg = (empresa?.iaVentasConfigJson ?? {}) as {
    numerosInternos?: string[];
  };
  const internos = numerosInternos(
    admins.map((a) => a.celular),
    cfg.numerosInternos ?? [],
  );
  if (internos.length === 0) {
    console.log(
      'No hay números internos: ni celulares de administradores ni numerosInternos configurados.',
    );
    await prisma.$disconnect();
    return;
  }

  const prospectos = await prisma.leadProspecto.findMany({
    where: { empresaId },
    select: {
      id: true,
      telefonoProspecto: true,
      nombreProspecto: true,
      puntaje: true,
    },
  });
  const aBorrar = prospectos.filter((p) =>
    esNumeroInterno(p.telefonoProspecto, internos),
  );

  console.log(`Números internos: ${internos.join(', ')}`);
  console.log(`Prospectos en el embudo: ${prospectos.length}`);
  if (aBorrar.length === 0) {
    console.log('Ninguno es del propio negocio. Nada que limpiar.');
    await prisma.$disconnect();
    return;
  }
  for (const p of aBorrar) {
    console.log(
      `  - ${p.nombreProspecto ?? 'sin nombre'} (${p.telefonoProspecto}) puntaje ${p.puntaje}`,
    );
  }
  const { count } = await prisma.leadProspecto.deleteMany({
    where: { id: { in: aBorrar.map((p) => p.id) } },
  });
  console.log(
    `✔ ${count} prospecto(s) fuera del embudo. Las conversaciones quedan para poder leerlas.`,
  );
  await prisma.$disconnect();
}

/**
 * Borra TODAS las conversaciones de una empresa, para empezar las pruebas
 * desde cero.
 *
 * Usa el mismo camino que el botón "Borrar chat" del panel —no una consulta
 * aparte— para que las dos formas de borrar se lleven exactamente lo mismo:
 * si mañana aparece otra tabla que guarda el `conversacionId` sin clave
 * foránea, se arregla en un solo sitio.
 */
async function borrarChats(prisma: PrismaService, empresaId: number) {
  const convs = await prisma.leadConversacion.findMany({
    where: { empresaId },
    select: {
      id: true,
      telefonoProspecto: true,
      nombreProspecto: true,
      cantidadMensajes: true,
    },
    orderBy: { id: 'asc' },
  });
  if (convs.length === 0) {
    console.log('No hay conversaciones que borrar.');
    await prisma.$disconnect();
    return;
  }

  // `eliminarConversacion` solo toca prisma; las otras dependencias del
  // servicio no entran en juego en este camino.
  const servicio = new LeadsService(
    prisma,
    null as never,
    null as never,
    null as never,
  );
  console.log(`Borrando ${convs.length} conversación(es) de la empresa ${empresaId}:`);
  for (const c of convs) {
    const r = await servicio.eliminarConversacion(empresaId, c.id);
    console.log(
      `  - ${c.nombreProspecto ?? 'sin nombre'} (${c.telefonoProspecto}) · ${c.cantidadMensajes} mensajes` +
        `${r.consultas ? ` · ${r.consultas} consulta(s)` : ''}` +
        `${r.disparos ? ` · ${r.disparos} disparador(es)` : ''}` +
        `${r.comprobantes ? ` · ${r.comprobantes} comprobante(s)` : ''}`,
    );
  }
  console.log('✔ Listo. El empresario puede volver a escribir y la IA lo atiende desde cero.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
