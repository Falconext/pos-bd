import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    const empresaId = 1; // ID de empresa default en Desktop
    const catalogPath = path.join(__dirname, '../catalogo_ferreteria_export.json');

    if (!fs.existsSync(catalogPath)) {
        console.error(`❌ No se encontró el archivo: ${catalogPath}`);
        process.exit(1);
    }

    console.log(`🔌 Connected to DB at: ${process.env.DATABASE_URL}`);

    const rawData = fs.readFileSync(catalogPath, 'utf-8');
    const products = JSON.parse(rawData);

    console.log(`📦 Importando ${products.length} productos al sistema Desktop...`);

    // 1. Asegurar Rubro
    let rubro = await prisma.rubro.findFirst({ where: { nombre: 'Ferretería' } });
    if (!rubro) {
        rubro = await prisma.rubro.create({
            data: { nombre: 'Ferretería' }
        });
    }

    // 2. Asegurar Unidad de Medida Default
    let unidadDefault = await prisma.unidadMedida.findFirst({ where: { codigo: 'NIU' } });
    if (!unidadDefault) {
        // Si no existe (base vacía), creamos las básicas
        unidadDefault = await prisma.unidadMedida.create({
            data: { codigo: 'NIU', nombre: 'UNIDAD' }
        });
    }

    // 3. Importar
    let count = 0;
    for (const p of products) {
        // A. Insertar en Plantillas (Catálogo Global Local)
        // Usamos Upsert para no duplicar si se corre varias veces
        const codigo = p.codigo || `FER-${Math.floor(Math.random() * 100000)}`;

        await prisma.productoPlantilla.upsert({
            where: { codigo: codigo },
            update: {}, // Si existe, no hacemos nada (o podríamos actualizar precios)
            create: {
                nombre: p.nombre,
                descripcion: p.descripcion,
                codigo: codigo,
                precioSugerido: p.precioSugerido,
                imagenUrl: p.imagenUrl,
                unidadConteo: p.unidadConteo,
                categoria: p.categoria,
                marca: p.marca,
                rubroId: rubro.id
            }
        });

        // B. Insertar en Inventario de Tienda (Empresa 1)
        // Verificar Categoría
        let categoriaId: number | null = null;
        if (p.categoria) {
            const cat = await prisma.categoria.findFirst({
                where: { empresaId, nombre: p.categoria }
            });
            if (cat) {
                categoriaId = cat.id;
            } else {
                const newCat = await prisma.categoria.create({
                    data: { empresaId, nombre: p.categoria }
                });
                categoriaId = newCat.id;
            }
        }

        // Verificar Marca
        let marcaId: number | null = null;
        if (p.marca) {
            const marca = await prisma.marca.findFirst({
                where: { empresaId, nombre: p.marca }
            });
            if (marca) {
                marcaId = marca.id;
            } else {
                const newMarca = await prisma.marca.create({
                    data: { empresaId, nombre: p.marca }
                });
                marcaId = newMarca.id;
            }
        }

        // Upsert Producto
        await prisma.producto.upsert({
            where: {
                empresaId_codigo: { empresaId, codigo }
            },
            update: {
                // Opcional: actualizar precio si ya existe
                precioUnitario: p.precioSugerido
            },
            create: {
                empresaId,
                codigo,
                descripcion: p.nombre,
                descripcionLarga: p.descripcion,
                precioUnitario: p.precioSugerido,
                valorUnitario: Number(p.precioSugerido) / 1.18,
                stock: 0, // Inicia en 0
                stockMinimo: p.stockMinimo || 5,
                unidadMedidaId: unidadDefault.id,
                categoriaId,
                marcaId,
                tipoAfectacionIGV: '10', // Gravado por defecto
                estado: 'ACTIVO',
                publicarEnTienda: true,
                imagenUrl: p.imagenUrl
            }
        });

        count++;
        if (count % 50 === 0) console.log(`   Procesados ${count}...`);
    }

    console.log(`✅ Importación finalizada: ${count} productos agregados.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
