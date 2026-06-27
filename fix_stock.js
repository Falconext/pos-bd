"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const empresas = await prisma.empresa.findMany();
    for (const empresa of empresas) {
        const principal = await prisma.sede.findFirst({ where: { empresaId: empresa.id, esPrincipal: true } });
        if (!principal)
            continue;
        const productos = await prisma.producto.findMany({ where: { empresaId: empresa.id }, include: { lotes: true } });
        let updated = 0;
        for (const p of productos) {
            const stockDesdeLotes = (p.lotes || []).reduce((acc, lote) => acc + Number(lote.stockActual || 0), 0);
            const usaStockLotes = stockDesdeLotes > 0;
            const trueStock = usaStockLotes ? stockDesdeLotes : Number(p.stock || 0);
            if (trueStock > 0) {
                // Upsert ProductoStock for principal sede
                const ps = await prisma.productoStock.findUnique({ where: { productoId_sedeId: { productoId: p.id, sedeId: principal.id } } });
                if (ps) {
                    if (ps.stock === 0) {
                        await prisma.productoStock.update({
                            where: { id: ps.id },
                            data: { stock: trueStock }
                        });
                        updated++;
                    }
                }
                else {
                    await prisma.productoStock.create({
                        data: {
                            productoId: p.id,
                            sedeId: principal.id,
                            stock: trueStock,
                            stockMinimo: p.stockMinimo ?? 0,
                            stockMaximo: p.stockMaximo,
                        }
                    });
                    updated++;
                }
            }
        }
        console.log(`Empresa ${empresa.id}: Updated ${updated} ProductoStock records for principal Sede ${principal.id}`);
    }
}
main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
