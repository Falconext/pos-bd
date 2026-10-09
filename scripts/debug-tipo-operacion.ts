
import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    try {
        const tipos = await prisma.tipoOperacion.findMany();
        console.log('----- TIPO OPERACION -----');
        console.table(tipos);

        console.log('--- BUSCANDO ID 1 ---');
        const id1 = await prisma.tipoOperacion.findUnique({ where: { id: 1 } });
        console.log('ID 1:', id1);

        const detracciones = await prisma.tipoDetraccion.findMany();
        console.log('----- TIPO DETRACCION -----');
        console.table(detracciones);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
