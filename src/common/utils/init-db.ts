
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

export async function initializeDatabase(prisma: PrismaService) {
    try {
        const userCount = await prisma.usuario.count();
        if (userCount > 0) return; // Already initialized

        console.log('🚀 Initializing database with default data...');

        // 1. Create Default Rubro
        let rubro = await prisma.rubro.findFirst();
        if (!rubro) {
            rubro = await prisma.rubro.create({
                data: { nombre: 'General' }
            });
        }

        // 2. Create Default Plan
        let plan = await prisma.plan.findFirst();
        if (!plan) {
            plan = await prisma.plan.create({
                data: {
                    nombre: 'PRO',
                    costo: 0,
                    esPrueba: false,
                    tipoFacturacion: 'ANUAL',
                    tieneTienda: true,
                    tieneBanners: true,
                    tieneGaleria: true,
                    tieneCulqi: true,
                    tieneDeliveryGPS: true
                }
            });
        }

        // 3. Create Default Company
        const empresa = await prisma.empresa.create({
            data: {
                ruc: '20000000001',
                razonSocial: 'MI EMPRESA S.A.C.',
                direccion: 'Av. Principal 123',
                fechaActivacion: new Date(),
                fechaExpiracion: new Date(new Date().setFullYear(new Date().getFullYear() + 10)),
                planId: plan.id,
                rubroId: rubro.id,
                estado: 'ACTIVO',
                tipoEmpresa: 'FORMAL',
                // Tienda defaults
                slugTienda: 'mi-tienda',
                colorPrimario: '#000000',
                aceptaEfectivo: true
            }
        });

        // 4. Create Admin User
        const hashedPassword = await bcrypt.hash('admin123', 10);

        await prisma.usuario.create({
            data: {
                nombre: 'Administrador',
                dni: '00000001',
                celular: '999999999',
                email: 'admin@falconext.com',
                password: hashedPassword,
                rol: 'ADMIN_EMPRESA',
                empresaId: empresa.id,
                estado: 'ACTIVO',
                permisos: 'ALL'
            }
        });

        console.log('✅ Database initialized successfully!');
        console.log('🔑 Credentials: admin@falconext.com / admin123');

    } catch (error) {
        console.error('❌ Error initializing database:', error);
    }
}
