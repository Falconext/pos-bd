
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Listing Plans...');
    const plans = await prisma.plan.findMany();
    console.log(plans);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
