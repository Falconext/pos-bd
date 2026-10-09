
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Fixing Reseller Linkage...');
    const resellers = await prisma.reseller.findMany();

    for (const r of resellers) {
        const user = await prisma.usuario.findUnique({ where: { email: r.email } });
        if (user && !user.resellerId) {
            await prisma.usuario.update({
                where: { id: user.id },
                data: { resellerId: r.id }
            });
            console.log(`✅ Linked User ${user.email} to Reseller ID ${r.id}`);
        }
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
