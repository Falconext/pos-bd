import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const sedes = await prisma.sede.findMany({
        orderBy: { id: 'desc' },
        take: 5
    });
    console.log(sedes);
}
main().catch(console.error).finally(() => prisma.$disconnect());
