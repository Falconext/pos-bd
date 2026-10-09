import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    const empresaId = 1; // Tu ID de empresa principal

    console.log(`📦 Exportando catálogo de Empresa ID ${empresaId}...`);

    const productos = await prisma.producto.findMany({
        where: {
            empresaId,
            estado: 'ACTIVO'
        },
        include: {
            categoria: true,
            marca: true,
            unidadMedida: true
        }
    });

    const catalog = productos.map(p => ({
        nombre: p.descripcion,
        descripcion: p.descripcionLarga || p.descripcion,
        codigo: p.codigo,
        precioSugerido: Number(p.precioUnitario),
        imagenUrl: p.imagenUrl,
        categoria: p.categoria?.nombre || 'General',
        marca: p.marca?.nombre || 'Genérico',
        unidadConteo: p.unidadMedida?.codigo || 'NIU',
        // Datos extras opcionales
        costo: Number(p.costoPromedio || 0),
        stockMinimo: p.stockMinimo || 0
    }));

    const outputPath = path.join(__dirname, '../catalogo_ferreteria_export.json');
    fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2));

    console.log(`✅ Exportación completada.`);
    console.log(`📄 Archivo generado: ${outputPath}`);
    console.log(`📊 Total productos: ${catalog.length}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
