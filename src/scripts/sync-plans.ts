import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Iniciando sincronización de planes (Upsert)...');

    const inputPath = path.join(__dirname, '../../plans-export.json');

    if (!fs.existsSync(inputPath)) {
        console.error(`❌ No se encontró el archivo: ${inputPath}`);
        console.error('Ejecuta primero: npx ts-node src/scripts/export-plans.ts');
        process.exit(1);
    }

    const rawData = fs.readFileSync(inputPath, 'utf8');
    const plans = JSON.parse(rawData);

    console.log(`📦 Leídos ${plans.length} planes del archivo.`);

    for (const plan of plans) {
        console.log(`🔄 Procesando plan: ${plan.nombre}...`);

        // Removemos campos que no deben sobrescribirse o que son autogenerados si es necesario
        // Pero para ID, si queremos mantener consistencia y es posible, lo intentamos.
        // Sin embargo, si en prod los IDs son diferentes, upsert por ID fallaría si no existe.
        // La estrategia aprobada fue Upsert por NOMBRE.

        // Preparamos data para insert/update
        // IMPORTANTE: id no se debe mandar en 'create' si es autoincrement, 
        // a menos que queramos forzarlo (lo cual puede dar error si ya existe otro con ese id).
        // Mejor dejamos que Prod asigne IDs nuevos si crea, y solo actualizamos campos si existe.
        // PERO: Si el usuario quiere "clonar" exactamente, los IDs importan. 
        // Si ya existen relaciones en prod, cambiar IDs es peligroso.
        // ASUMIREMOS: Match por NOMBRE. Y actualizamos el resto.

        const { id, empresas, ...planData } = plan; // Omitimos ID y relaciones para el payload

        // Asegurar tipos correctos (Decimales vienen como strings en el JSON a veces)
        /* 
           Prisma espera Decimal o string que parezca número para Decimal.
           Booleanos son booleanos.
           Strings son strings.
         */

        await prisma.plan.upsert({
            where: { nombre: plan.nombre }, // Clave única
            update: {
                ...planData,
                // Forzamos conversión o limpieza si es necesario
            },
            create: {
                ...planData,
                // nombre ya está en planData
            },
        });
    }

    console.log('✅ Sincronización completada exitosamente.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
