/**
 * Siembra la empresa de pruebas de Hierba Sana en la base LOCAL.
 *
 * La IA de Ventas no se puede probar en serio sin su catálogo: las preguntas
 * del banco del cliente son por berberina, moringa o uña de gato, y lo que hay
 * que verificar es justamente que los precios salgan del catálogo real.
 *
 * NO toca producción. Aborta si la URL de la base no apunta a localhost.
 *
 *   export DATABASE_URL=postgresql://postgres:developer@localhost:5432/sistema_mype
 *   npx ts-node scripts/seed-hierba-sana-local.ts [ruta/al/excel.xlsx]
 */
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as os from 'os';

const EMPRESA_ID = 89;
const RUC = '20610516158';
/** El phone_number_id con el que el webhook local resuelve esta empresa. */
const PHONE_NUMBER_ID = 'LOCAL-QA-HIERBA-SANA';

const EXCEL_POR_DEFECTO = path.join(
  os.homedir(),
  'Downloads',
  'IMPORTAR_PRODUCTOS_HIERBA_SANA.xlsx',
);

interface FilaExcel {
  CÓDIGO: string;
  'CÓDIGO DE BARRAS': string;
  PRODUCTO: string;
  'PRECIO UNITARIO CON IGV': number | string;
  STOCK: number | string;
  CATEGORIA: string;
  MARCA: string;
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(
      `DATABASE_URL no apunta a localhost. Este script solo siembra en local.\nURL: ${url.replace(/:[^:@]*@/, ':***@')}`,
    );
  }

  const prisma = new PrismaClient();
  const excel = process.argv[2] ?? EXCEL_POR_DEFECTO;

  // 1) Empresa. Se reusa el plan y el rubro de alguna empresa existente para
  //    no inventar catálogos de la plataforma.
  const plan = await prisma.plan.findFirst({ select: { id: true } });
  if (!plan) throw new Error('La base local no tiene ningún Plan.');
  const rubro = await prisma.rubro.findFirst({ select: { id: true } });

  const datosEmpresa = {
    ruc: RUC,
    razonSocial: 'HIERBA SANA COMPANY E.I.R.L.',
    nombreComercial: 'Hierba Sana',
    direccion: 'Av. Emancipación 687, Lima Cercado',
    fechaActivacion: new Date(),
    fechaExpiracion: new Date(Date.now() + 365 * 864e5),
    planId: plan.id,
    rubroId: rubro?.id ?? null,
    // La IA responde, pero el número es de mentira: cualquier envío a Meta
    // falla y se queda en el log. Nadie recibe un WhatsApp desde aquí.
    whatsappPhoneNumberId: PHONE_NUMBER_ID,
    whatsappBusinessId: 'LOCAL-QA-WABA',
    whatsappApiToken: 'LOCAL-QA-TOKEN-INVALIDO',
    whatsappProvider: 'EMPRESA' as const,
    whatsappActivo: true,
    iaVentasActiva: true,
    iaVentasSeguimiento: false,
    iaVentasCotizacion: false,
  };

  await prisma.empresa.upsert({
    where: { id: EMPRESA_ID },
    create: { id: EMPRESA_ID, ...datosEmpresa },
    update: datosEmpresa,
  });
  console.log(`✔ Empresa ${EMPRESA_ID} lista (plan ${plan.id}).`);

  // 2) Catálogo.
  const filas = XLSX.utils.sheet_to_json<FilaExcel>(
    XLSX.readFile(excel).Sheets.Productos,
    { defval: '' },
  );
  console.log(`  Leyendo ${filas.length} productos de ${excel}`);

  const um = await prisma.unidadMedida.findFirst({ select: { id: true } });
  if (!um) throw new Error('La base local no tiene UnidadMedida.');

  const idDe = async (
    tabla: 'categoria' | 'marca',
    nombre: string,
    cache: Map<string, number>,
  ): Promise<number | null> => {
    const limpio = (nombre || '').trim();
    if (!limpio) return null;
    const enCache = cache.get(limpio);
    if (enCache) return enCache;
    const modelo = prisma[tabla] as {
      findFirst: (a: unknown) => Promise<{ id: number } | null>;
      create: (a: unknown) => Promise<{ id: number }>;
    };
    const existente = await modelo.findFirst({
      where: { nombre: limpio, empresaId: EMPRESA_ID },
      select: { id: true },
    });
    const fila =
      existente ??
      (await modelo.create({
        data: { nombre: limpio, empresaId: EMPRESA_ID },
        select: { id: true },
      }));
    cache.set(limpio, fila.id);
    return fila.id;
  };

  const cats = new Map<string, number>();
  const marcas = new Map<string, number>();

  await prisma.producto.deleteMany({ where: { empresaId: EMPRESA_ID } });

  let creados = 0;
  for (const f of filas) {
    const precio = Number(f['PRECIO UNITARIO CON IGV']) || 0;
    await prisma.producto.create({
      data: {
        empresaId: EMPRESA_ID,
        codigo: String(f['CÓDIGO']).trim(),
        codigoBarras: String(f['CÓDIGO DE BARRAS']).trim() || null,
        descripcion: String(f.PRODUCTO).trim(),
        unidadMedidaId: um.id,
        tipoAfectacionIGV: '10',
        precioUnitario: precio,
        // El Excel trae el precio CON IGV; el valor unitario es sin él.
        valorUnitario: Number((precio / 1.18).toFixed(4)),
        stock: Number(f.STOCK) || 0,
        categoriaId: await idDe('categoria', f.CATEGORIA, cats),
        marcaId: await idDe('marca', f.MARCA, marcas),
        estado: 'ACTIVO',
      },
    });
    creados++;
    if (creados % 250 === 0) console.log(`  … ${creados}/${filas.length}`);
  }

  console.log(
    `✔ ${creados} productos, ${cats.size} categorías, ${marcas.size} marcas.`,
  );
  console.log(`\nphone_number_id para el webhook local: ${PHONE_NUMBER_ID}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
