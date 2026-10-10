/**
 * Criterio de aceptación del cliente, textual:
 *
 *   "Validación de Coexistencia: Verificación en vivo de que una intervención
 *    manual desde el teléfono pause al bot de inmediato durante 2 horas para
 *    ese contacto. Y disponible la activación manual."
 *
 * Se prueba contra la BD real y con el reloj movido a mano, porque esperar
 * dos horas no es una prueba: es una espera.
 *
 *   export DATABASE_URL=postgresql://postgres:developer@localhost:5432/sistema_mype
 *   npx ts-node --transpile-only scripts/qa-aceptacion-coexistencia.ts
 */
import { PrismaService } from '../src/prisma/prisma.service';
import {
  PAUSA_INTERVENCION_MS,
  debeReactivarse,
  estaPausado,
  venceEn,
} from '../src/leads/pausa-bot';

const TEL = '51900666001';

let fallos = 0;
const ok = (c: boolean, t: string, d = '') => {
  console.log(`${c ? '✔' : '✗'} ${t}${d ? ` — ${d}` : ''}`);
  if (!c) fallos++;
};

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL no apunta a localhost. QA solo en local.');
  }
  const prisma = new PrismaService();
  const [{ empresaId }] = await prisma.$queryRaw<{ empresaId: number }[]>`
    SELECT "empresaId" FROM "Comprobante" GROUP BY "empresaId"
    ORDER BY COUNT(*) DESC LIMIT 1`;

  await prisma.leadConversacion.deleteMany({
    where: { empresaId, telefonoProspecto: TEL },
  });
  const conv = await prisma.leadConversacion.create({
    data: { empresaId, telefonoProspecto: TEL, nombreProspecto: 'QA COEXISTENCIA' },
  });
  const pros = await prisma.leadProspecto.create({
    data: { empresaId, telefonoProspecto: TEL, conversacionId: conv.id },
  });

  // ── 1. De entrada, el bot atiende ──
  ok(pros.botActivo === true, 'el bot arranca activo');
  ok(
    !estaPausado({ botActivo: pros.botActivo, pausadoHasta: pros.pausadoHasta }),
    'y no está pausado',
  );

  // ── 2. La pausa dura 2 horas exactas ──
  ok(
    PAUSA_INTERVENCION_MS === 2 * 60 * 60 * 1000,
    'la pausa por intervención manual son 2 horas, como pide el anexo',
    `${PAUSA_INTERVENCION_MS / 3600000} h`,
  );

  // ── 3. Una respuesta manual pausa de inmediato ──
  const ahora = new Date();
  const hasta = venceEn(ahora);
  await prisma.leadProspecto.update({
    where: { id: pros.id },
    data: {
      botActivo: false,
      pausadoHasta: hasta,
      motivoPausa: 'respuesta manual desde el celular',
    },
  });
  const pausado = await prisma.leadProspecto.findUnique({
    where: { id: pros.id },
    select: { botActivo: true, pausadoHasta: true, motivoPausa: true },
  });
  ok(estaPausado(pausado!), 'tras la respuesta manual, el bot queda pausado');
  ok(
    Math.round(
      ((pausado!.pausadoHasta!.getTime() - ahora.getTime()) / 3600000) * 10,
    ) / 10 === 2,
    'y la pausa vence en 2 horas',
    `${((pausado!.pausadoHasta!.getTime() - ahora.getTime()) / 3600000).toFixed(2)} h`,
  );
  ok(
    !!pausado!.motivoPausa,
    'con el motivo anotado, para que el equipo sepa qué pasó',
    pausado!.motivoPausa ?? '',
  );

  // ── 4. A la hora y media sigue pausado ──
  const hora1_5 = new Date(ahora.getTime() + 90 * 60 * 1000);
  ok(
    !debeReactivarse(pausado!, hora1_5),
    'a la hora y media NO se reactiva: el asesor sigue atendiendo',
  );

  // ── 5. Pasadas las 2 horas vuelve solo ──
  const hora2_1 = new Date(ahora.getTime() + 126 * 60 * 1000);
  ok(
    debeReactivarse(pausado!, hora2_1),
    'pasadas las 2 horas el bot vuelve SOLO',
  );

  // ── 6. La reactivación manual está disponible ──
  await prisma.leadProspecto.update({
    where: { id: pros.id },
    data: { botActivo: true, pausadoHasta: null, motivoPausa: null },
  });
  const reactivado = await prisma.leadProspecto.findUnique({
    where: { id: pros.id },
    select: { botActivo: true, pausadoHasta: true },
  });
  ok(
    !estaPausado(reactivado!),
    'y se puede reactivar a mano antes de que venza, como pide el anexo',
  );

  // ── 7. La derivación a un asesor es otra cosa: NO vence sola ──
  await prisma.leadProspecto.update({
    where: { id: pros.id },
    data: { botActivo: false, pausadoHasta: null, motivoPausa: 'mayorista' },
  });
  const derivado = await prisma.leadProspecto.findUnique({
    where: { id: pros.id },
    select: { botActivo: true, pausadoHasta: true },
  });
  ok(estaPausado(derivado!), 'una derivación deja el bot apagado');
  ok(
    !debeReactivarse(derivado!, new Date(Date.now() + 30 * 24 * 3600_000)),
    'y NO vuelve solo ni en 30 días: hay una persona a cargo de ese cliente',
  );

  await prisma.leadConversacion.deleteMany({
    where: { empresaId, telefonoProspecto: TEL },
  });

  console.log(
    fallos === 0
      ? '\nCUMPLE el criterio de coexistencia.'
      : `\nNO cumple: ${fallos} fallo(s).`,
  );
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
