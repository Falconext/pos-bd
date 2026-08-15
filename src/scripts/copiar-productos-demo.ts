/**
 * Copia productos CON IMAGEN de una empresa origen a una empresa destino (demo).
 *
 * - Solo lectura sobre el origen; solo inserta en el destino.
 * - Recrea en el destino únicamente las categorías/marcas que usan esos productos
 *   (find-or-create por nombre) para que los productos queden válidos y visibles;
 *   NO copia clientes, ventas ni ningún otro dato.
 * - Idempotente: si el destino ya tiene un producto con el mismo código, lo omite.
 *
 * Uso:  npx ts-node src/scripts/copiar-productos-demo.ts
 *   Variables opcionales: SRC_RUC, DST_RUC, LIMITE, DRY_RUN=1
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SRC_RUC = process.env.SRC_RUC || '20613521136';
const DST_RUC = process.env.DST_RUC || '20565895118';
const LIMITE = Number(process.env.LIMITE || 20);
const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  const [origen, destino] = await Promise.all([
    prisma.empresa.findFirst({ where: { ruc: SRC_RUC }, select: { id: true, razonSocial: true } }),
    prisma.empresa.findFirst({ where: { ruc: DST_RUC }, select: { id: true, razonSocial: true } }),
  ]);
  if (!origen) throw new Error(`No existe empresa origen con RUC ${SRC_RUC}`);
  if (!destino) throw new Error(`No existe empresa destino con RUC ${DST_RUC}`);

  console.log(`ORIGEN : #${origen.id} ${origen.razonSocial} (${SRC_RUC})`);
  console.log(`DESTINO: #${destino.id} ${destino.razonSocial} (${DST_RUC})`);
  console.log(`Copiando hasta ${LIMITE} productos con imagen${DRY_RUN ? '  [DRY RUN]' : ''}\n`);

  const productos = await prisma.producto.findMany({
    where: {
      empresaId: origen.id,
      estado: 'ACTIVO',
      imagenUrl: { not: null },
      NOT: { imagenUrl: '' },
    },
    orderBy: [{ destacado: 'desc' }, { id: 'asc' }],
    take: LIMITE,
    include: {
      categoria: { select: { nombre: true, imagenUrl: true } },
      marca: { select: { nombre: true, imagenUrl: true } },
    },
  });

  // Caches para no crear la misma categoría/marca varias veces.
  const catCache = new Map<string, number>();
  const marcaCache = new Map<string, number>();

  const resolverCategoria = async (nombre?: string | null, imagenUrl?: string | null) => {
    if (!nombre) return null;
    if (catCache.has(nombre)) return catCache.get(nombre)!;
    let cat = await prisma.categoria.findFirst({
      where: { empresaId: destino.id, nombre },
      select: { id: true },
    });
    if (!cat && !DRY_RUN) {
      cat = await prisma.categoria.create({
        data: { empresaId: destino.id, nombre, imagenUrl: imagenUrl ?? null },
        select: { id: true },
      });
    }
    const id = cat?.id ?? -1;
    catCache.set(nombre, id);
    return id === -1 ? null : id;
  };

  const resolverMarca = async (nombre?: string | null, imagenUrl?: string | null) => {
    if (!nombre) return null;
    if (marcaCache.has(nombre)) return marcaCache.get(nombre)!;
    let marca = await prisma.marca.findFirst({
      where: { empresaId: destino.id, nombre },
      select: { id: true },
    });
    if (!marca && !DRY_RUN) {
      marca = await prisma.marca.create({
        data: { empresaId: destino.id, nombre, imagenUrl: imagenUrl ?? null },
        select: { id: true },
      });
    }
    const id = marca?.id ?? -1;
    marcaCache.set(nombre, id);
    return id === -1 ? null : id;
  };

  const creados: { id: number; codigo: string; descripcion: string }[] = [];
  let omitidos = 0;

  for (const p of productos) {
    // Idempotencia: no duplicar si ya existe ese código en el destino.
    const yaExiste = await prisma.producto.findFirst({
      where: { empresaId: destino.id, codigo: p.codigo },
      select: { id: true },
    });
    if (yaExiste) {
      console.log(`  = OMITIDO (ya existe código ${p.codigo}): ${p.descripcion}`);
      omitidos++;
      continue;
    }

    const categoriaId = await resolverCategoria(p.categoria?.nombre, p.categoria?.imagenUrl);
    const marcaId = await resolverMarca(p.marca?.nombre, p.marca?.imagenUrl);

    if (DRY_RUN) {
      console.log(`  + (dry) ${p.codigo}  ${p.descripcion}  [cat:${p.categoria?.nombre ?? '-'} | marca:${p.marca?.nombre ?? '-'}]`);
      continue;
    }

    const nuevo = await prisma.producto.create({
      data: {
        empresaId: destino.id,
        codigo: p.codigo,
        descripcion: p.descripcion,
        descripcionLarga: p.descripcionLarga,
        categoriaId,
        marcaId,
        unidadMedidaId: p.unidadMedidaId, // global, se reutiliza
        tipoAfectacionIGV: p.tipoAfectacionIGV,
        igvPorcentaje: p.igvPorcentaje,
        moneda: p.moneda,
        precioUnitario: p.precioUnitario,
        valorUnitario: p.valorUnitario,
        stock: p.stock,
        estado: 'ACTIVO',
        // Imágenes: se copian las mismas URLs de S3 (referencia compartida).
        imagenUrl: p.imagenUrl,
        imagenesExtra: p.imagenesExtra,
        publicarEnTienda: true,
        destacado: p.destacado,
        presentacion: p.presentacion,
        codigoBarras: p.codigoBarras,
        codProdSunat: p.codProdSunat,
        pesoGramos: p.pesoGramos,
        volumenMl: p.volumenMl,
        atributosTecnicos: p.atributosTecnicos ?? undefined,
      },
      select: { id: true, codigo: true, descripcion: true },
    });
    creados.push(nuevo);
    console.log(`  + CREADO #${nuevo.id}  ${nuevo.codigo}  ${nuevo.descripcion}`);
  }

  console.log(`\nResumen: ${creados.length} creados, ${omitidos} omitidos.`);
  if (creados.length) {
    console.log('IDs creados (para revertir si hiciera falta):');
    console.log('  ' + creados.map((c) => c.id).join(', '));
  }
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
