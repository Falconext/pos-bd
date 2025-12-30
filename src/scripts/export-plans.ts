import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Iniciando exportación de planes...');

    try {
        const plans = await prisma.plan.findMany({
            orderBy: { id: 'asc' },
        });

        console.log(`✅ Se encontraron ${plans.length} planes.`);

        const outputPath = path.join(__dirname, '../../plans-export.json');

        // Convertir Decimal a string/number para JSON (Prisma devuelve Decimal que no es serializable directamente a veces, o sí pero checkeamos)
        // JSON.stringify maneja objetos básicos. Prisma Decimal suele necesitar tratamiento si se va a re-importar, 
        // pero para este sync script, nos aseguraremos de parsear correctamente.
        // Hack: JSON stringify + parse para limpiar tipos complejos si es necesario, 
        // aunque lo mejor es mapear si hay custom objects.

        fs.writeFileSync(outputPath, JSON.stringify(plans, null, 2));

        console.log(`💾 Data guardada en: ${outputPath}`);

        // Generar snippet para verification visual
        console.log('--- Muestra de data (primer plan) ---');
        if (plans.length > 0) console.log(plans[0]);
        console.log('-------------------------------------');

    } catch (error) {
        console.error('❌ Error exportando planes:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
