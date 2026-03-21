import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Iniciando migración de Sedes y Stock...');

    // 1. Obtener todas las empresas
    const empresas = await prisma.empresa.findMany({
        include: { sedes: true },
    });

    console.log(`📦 Empresas encontradas: ${empresas.length}`);

    for (const empresa of empresas) {
        let sedePrincipalId: number;

        // 2. Verificar/Crear Sede Principal
        const sedePrincipal = empresa.sedes.find((s) => s.esPrincipal);

        if (sedePrincipal) {
            sedePrincipalId = sedePrincipal.id;
            // console.log(`✅ Empresa ${empresa.razonSocial} (${empresa.id}) ya tiene sede principal.`);
        } else {
            console.log(`⚠️  Empresa ${empresa.razonSocial} (${empresa.id}) NO tiene sede. Creando...`);
            const nuevaSede = await prisma.sede.create({
                data: {
                    empresaId: empresa.id,
                    nombre: 'Sede Principal',
                    direccion: empresa.direccion || 'Dirección Fiscal',
                    codigo: '001',
                    esPrincipal: true,
                    activo: true,
                },
            });
            sedePrincipalId = nuevaSede.id;
            console.log(`   ✨ Sede creada con ID: ${sedePrincipalId}`);
        }

        // 3. Sincronizar Stock (Producto -> ProductoStock)
        // Buscamos productos que NO tengan stock en esta sede
        const productos = await prisma.producto.findMany({
            where: {
                empresaId: empresa.id,
                estado: { not: 'PLACEHOLDER' }, // Ignorar eliminados
            },
            include: {
                stocks: {
                    where: { sedeId: sedePrincipalId },
                },
            },
        });

        let productosActualizados = 0;

        for (const producto of productos) {
            // Si no tiene registro en ProductoStock para la sede principal
            if (producto.stocks.length === 0) {
                // Obtenemos el stock "legacy" de la tabla Producto
                const stockLegacy = producto.stock || 0;

                await prisma.productoStock.create({
                    data: {
                        productoId: producto.id,
                        sedeId: sedePrincipalId,
                        stock: stockLegacy, // Migramos el stock existente
                        stockMinimo: producto.stockMinimo || 0,
                        stockMaximo: producto.stockMaximo,
                    },
                });
                productosActualizados++;
            }
        }

        if (productosActualizados > 0) {
            console.log(`   🔄 Stock sincronizado para ${productosActualizados} productos en Empresa ${empresa.id}`);
        }
    }

    console.log('✅ Migración completada exitosamente.');
}

main()
    .catch((e) => {
        console.error('❌ Error en la migración:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
