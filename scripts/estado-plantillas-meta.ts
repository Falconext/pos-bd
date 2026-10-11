/**
 * ¿Ya aprobó Meta las plantillas? — consulta de SOLO LECTURA.
 *
 * Existe porque el panel no muestra el estado de aprobación: el botón "Dar de
 * alta" las manda y después no hay forma de saber en qué quedaron sin entrar a
 * Business Manager. Esto lo pregunta a Meta directo.
 *
 * No escribe nada: ni en la base, ni en Meta. Lee la WABA y el token de la
 * empresa y hace un GET.
 *
 *   npx tsx scripts/estado-plantillas-meta.ts 89
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

/**
 * El .env a mano: PrismaClient no lo lee solo (solo lo hace el CLI de Prisma)
 * y el proyecto no tiene dotenv. Sin esto el script muere con "Environment
 * variable not found: DATABASE_URL" aunque el .env esté ahí al lado.
 */
function cargarEnv(): void {
  if (process.env.DATABASE_URL) return;
  const texto = readFileSync(join(__dirname, '..', '.env'), 'utf8');
  for (const linea of texto.split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(linea);
    if (!m) continue;
    const valor = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = valor;
  }
}
cargarEnv();

const ORDEN = ['APPROVED', 'PENDING', 'IN_APPEAL', 'REJECTED', 'PAUSED'];

async function main() {
  const empresaId = Number(process.argv[2] ?? 89);
  const prisma = new PrismaClient();
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        nombreComercial: true,
        whatsappBusinessId: true,
        whatsappApiToken: true,
      },
    });
    if (!empresa) throw new Error(`No existe la empresa ${empresaId}`);
    if (!empresa.whatsappBusinessId || !empresa.whatsappApiToken) {
      throw new Error(
        `${empresa.nombreComercial} no tiene su WhatsApp conectado (falta WABA o token)`,
      );
    }

    const { data } = await axios.get(
      `https://graph.facebook.com/v21.0/${empresa.whatsappBusinessId}/message_templates`,
      {
        params: { limit: 100, fields: 'name,status,category,rejected_reason' },
        headers: { Authorization: `Bearer ${empresa.whatsappApiToken}` },
        timeout: 20000,
      },
    );

    const plantillas: {
      name: string;
      status: string;
      category: string;
      rejected_reason?: string;
    }[] = data.data ?? [];

    plantillas.sort(
      (a, b) =>
        ORDEN.indexOf(a.status) - ORDEN.indexOf(b.status) ||
        a.name.localeCompare(b.name),
    );

    console.log(`\n${empresa.nombreComercial} — ${plantillas.length} plantillas\n`);
    for (const p of plantillas) {
      const motivo =
        p.rejected_reason && p.rejected_reason !== 'NONE'
          ? `  ← ${p.rejected_reason}`
          : '';
      console.log(
        `  ${p.status.padEnd(10)} ${p.category.padEnd(10)} ${p.name}${motivo}`,
      );
    }

    const porEstado = plantillas.reduce<Record<string, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `\n  ${Object.entries(porEstado)
        .map(([e, n]) => `${n} ${e}`)
        .join(' · ')}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(
    '\n  Falló:',
    e.response?.data?.error?.message ?? e.message,
    '\n',
  );
  process.exit(1);
});
