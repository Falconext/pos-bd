import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    // Get the most recently created Sede
    const newestSede = await prisma.sede.findFirst({
        orderBy: { id: 'desc' }
    });
    
    if (!newestSede) {
        console.log("No sedes found in DB.");
        return;
    }
    
    console.log("Newest Sede:", newestSede);
    
    // Attempt the exact query used in selectSede
    const sede = await prisma.sede.findFirst({
        where: {
            id: newestSede.id,
            empresaId: newestSede.empresaId,
            activo: true
        }
    });
    
    console.log("Query result for selectSede:", sede);
}

main().catch(console.error).finally(() => prisma.$disconnect());
