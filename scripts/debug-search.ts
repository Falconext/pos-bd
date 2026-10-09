
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const search = 'DOLOCOD';
    console.log(`Searching for products matching "${search}"...`);

    const results = await prisma.producto.findMany({
        where: {
            OR: [
                // @ts-ignore
                { descripcion: { contains: search, mode: 'insensitive' } },
                // @ts-ignore
                { codigo: { contains: search, mode: 'insensitive' } },
            ],
        },
        select: {
            id: true,
            descripcion: true,
            codigo: true,
            empresaId: true,
            estado: true,
        },
    });

    console.log('Found products:', results);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
