
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    console.log('Checking Resellers and Users...');
    const resellers = await prisma.reseller.findMany({
        orderBy: { creadoEn: 'desc' },
        take: 5
    });

    for (const r of resellers) {
        console.log(`Reseller: ${r.nombre} (${r.email})`);
        const user = await prisma.usuario.findUnique({
            where: { email: r.email }
        });

        if (user) {
            console.log(`  ✅ User exists: ID ${user.id}, Role: ${user.rol}, Status: ${user.estado}`);
            // Reset password to 123456 just in case
            // const hash = await bcrypt.hash('123456', 10);
            // await prisma.usuario.update({ where: { id: user.id }, data: { password: hash } });
            // console.log('  🔄 Password reset to 123456');
        } else {
            console.log('  ❌ User DOES NOT exist. Creating...');
            const hashedPassword = await bcrypt.hash('123456', 10);
            try {
                await prisma.usuario.create({
                    data: {
                        nombre: r.nombre,
                        email: r.email,
                        password: hashedPassword,
                        rol: 'RESELLER', // Ensure this enum value exists or string
                        estado: 'ACTIVO',
                        dni: r.codigo || '00000000',
                        celular: r.telefono || '-'
                    }
                });
                console.log('  ✅ User created successfully.');
            } catch (e) {
                console.error('  ERROR creating user:', e.message);
            }
        }
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
