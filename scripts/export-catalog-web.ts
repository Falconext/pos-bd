/**
 * EXPORTAR CATÁLOGO GLOBAL DESDE WEB
 * Ejecutar este script en el backend conectado a PostgreSQL (Web)
 * para generar el JSON que se incluirá en el instalador Desktop.
 *
 * Uso: npx ts-node scripts/export-catalog-web.ts
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function exportCatalog() {
  console.log('📦 Exportando Catálogo Global desde Web...\n');

  // Obtener todas las plantillas del catálogo global
  const plantillas = await prisma.productoPlantilla.findMany({
    include: { rubro: true },
    orderBy: { nombre: 'asc' },
  });

  console.log(`   Encontrados: ${plantillas.length} productos en el catálogo`);

  // Transformar a formato limpio
  const catalog = plantillas.map((p) => ({
    nombre: p.nombre,
    descripcion: p.descripcion,
    codigo: p.codigo,
    precioSugerido: Number(p.precioSugerido) || 0,
    imagenUrl: p.imagenUrl,
    categoria: p.categoria,
    marca: p.marca,
    unidadConteo: p.unidadConteo || 'NIU',
    rubro: p.rubro?.nombre || 'General',
  }));

  // Guardar JSON
  const outputPath = path.join(__dirname, '../catalogo_ferreteria_export.json');
  fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2));

  console.log(`\n✅ Catálogo exportado exitosamente!`);
  console.log(`📄 Archivo: ${outputPath}`);
  console.log(`📊 Total productos: ${catalog.length}`);
  console.log(
    '\n💡 Siguiente paso: Copia este JSON a la carpeta del proyecto Desktop.',
  );
}

exportCatalog()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
