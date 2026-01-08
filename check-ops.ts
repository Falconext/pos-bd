
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const ops = await prisma.tipoOperacion.findMany();
    console.log('Total TipoOperacion:', ops.length);
    console.log(JSON.stringify(ops, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
