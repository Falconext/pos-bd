"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('--- Checking Modules ---');
    const modules = await prisma.modulo.findMany();
    modules.forEach(m => console.log(`${m.id}: ${m.nombre} (${m.codigo}) - Activo: ${m.activo}`));
    console.log('\n--- Checking Planes & Modules ---');
    const plans = await prisma.plan.findMany({
        include: {
            modulosAsignados: {
                include: { modulo: true }
            }
        }
    });
    plans.forEach(p => {
        console.log(`Plan: ${p.nombre} (ID: ${p.id})`);
        if (p.modulosAsignados.length === 0) {
            console.log('  -> No modules assigned');
        }
        else {
            p.modulosAsignados.forEach(pm => {
                console.log(`  -> Module: ${pm.modulo.nombre} (${pm.modulo.codigo})`);
            });
        }
    });
    console.log('\n--- Checking Cotizaciones Module specifically ---');
    const cotiz = await prisma.modulo.findFirst({ where: { codigo: 'cotizaciones' } });
    if (cotiz)
        console.log('✅ Module "cotizaciones" exists.');
    else
        console.log('❌ Module "cotizaciones" DOES NOT EXIST.');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
