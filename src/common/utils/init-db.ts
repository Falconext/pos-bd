
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { existsSync, copyFileSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';

export async function initializeDatabase(prisma: PrismaService) {
    try {
        // For desktop deployments: handle SQLite database initialization
        const dbUrl = process.env.DATABASE_URL || '';
        if (dbUrl.startsWith('file:')) {
            const dbPath = dbUrl.replace('file:', '');
            const templatePath = join(process.cwd(), 'prisma', 'nephi_pos_template.db');

            // Check if we need to copy the template
            let needsCopy = false;

            if (!existsSync(dbPath)) {
                console.log('📦 Database not found, will copy template...');
                needsCopy = true;
            } else {
                // Database exists - check if it's empty/too small (corrupted)
                try {
                    const stats = statSync(dbPath);
                    // Template is ~438KB, if user db is much smaller, it's likely empty
                    if (stats.size < 10000) {
                        console.log('📦 Database appears empty/corrupted, replacing with template...');
                        unlinkSync(dbPath);
                        needsCopy = true;
                    }
                } catch (e) {
                    needsCopy = true;
                }
            }

            if (needsCopy && existsSync(templatePath)) {
                try {
                    copyFileSync(templatePath, dbPath);
                    console.log('✅ Database template copied successfully!');
                } catch (copyError) {
                    console.error('❌ Error copying template database:', copyError.message);
                }
            } else if (needsCopy) {
                console.log('⚠️ No template database found, tables may be missing');
            }
        }

        // Try to count users - this will fail if tables don't exist
        let userCount = 0;
        try {
            userCount = await prisma.usuario.count();
            if (userCount > 0) return; // Already initialized
        } catch (tableError) {
            console.log('⚠️ Tables may not exist yet, attempting seeding anyway...');
        }

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

        // 3. Create TipoDocumento records (required for client creation)
        const tiposDocumento = [
            { codigo: '1', descripcion: 'DNI' },
            { codigo: '6', descripcion: 'RUC' },
            { codigo: '0', descripcion: 'OTROS' },
            { codigo: '4', descripcion: 'CARNET DE EXTRANJERÍA' },
            { codigo: '7', descripcion: 'PASAPORTE' },
        ];
        for (const tipo of tiposDocumento) {
            await prisma.tipoDocumento.upsert({
                where: { codigo: tipo.codigo },
                update: {},
                create: tipo,
            });
        }
        console.log('   ✅ TipoDocumento seeded');

        // 4. Create Default Company
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

        // 5. Create Default "Varios" Client
        const tipoDocDNI = await prisma.tipoDocumento.findUnique({ where: { codigo: '1' } });
        if (tipoDocDNI) {
            await prisma.cliente.create({
                data: {
                    nombre: 'VARIOS',
                    nroDoc: '00000000',
                    direccion: '-',
                    empresaId: empresa.id,
                    tipoDocumentoId: tipoDocDNI.id,
                    persona: 'CLIENTE',
                    estado: 'ACTIVO',
                }
            });
            console.log('   ✅ Default client "VARIOS" created');
        }

        // 6. Create Admin User with ADMIN_SISTEMA role
        const hashedPassword = await bcrypt.hash('admin123', 10);

        await prisma.usuario.create({
            data: {
                nombre: 'Administrador',
                dni: '00000001',
                celular: '999999999',
                email: 'admin@falconext.com',
                password: hashedPassword,
                rol: 'ADMIN_SISTEMA',
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
