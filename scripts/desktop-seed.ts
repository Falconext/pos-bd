// Comprehensive Desktop Seed Script
// Run during build to populate template database with all required data
// Usage: DATABASE_URL=file:./nephi_pos_template.db npx ts-node scripts/desktop-seed.ts

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface Departamento {
    id: string;
    name: string;
}

interface Provincia {
    id: string;
    name: string;
    department_id: string;
}

interface Distrito {
    id: string;
    name: string;
    province_id: string;
    department_id: string;
}

async function main() {
    console.log('🚀 Iniciando seed de datos para Desktop...');
    console.log(`   📁 Base de datos: ${process.env.DATABASE_URL}`);

    try {
        // 1. Seed TipoDocumento
        console.log('\n📋 1. Seeding TipoDocumento...');
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

        // 2. Seed Ubigeos
        console.log('\n🌍 2. Seeding Ubigeos...');
        const ubigeoCount = await prisma.ubigeo.count();
        if (ubigeoCount === 0) {
            const dataDir = path.join(__dirname, '../prisma/data');
            const deptPath = path.join(dataDir, 'departamentos.json');
            const provPath = path.join(dataDir, 'provincias.json');
            const distPath = path.join(dataDir, 'distritos.json');

            if (fs.existsSync(deptPath) && fs.existsSync(provPath) && fs.existsSync(distPath)) {
                const departamentos: Departamento[] = JSON.parse(fs.readFileSync(deptPath, 'utf-8'));
                const provincias: Provincia[] = JSON.parse(fs.readFileSync(provPath, 'utf-8'));
                const distritos: Distrito[] = JSON.parse(fs.readFileSync(distPath, 'utf-8'));

                const deptMap = new Map(departamentos.map(d => [d.id, d.name]));
                const provMap = new Map(provincias.map(p => [p.id, p.name]));

                const ubigeoData = distritos.map(d => ({
                    codigo: d.id,
                    departamento: deptMap.get(d.department_id) || '',
                    provincia: provMap.get(d.province_id) || '',
                    distrito: d.name,
                }));

                const batchSize = 500;
                for (let i = 0; i < ubigeoData.length; i += batchSize) {
                    const batch = ubigeoData.slice(i, i + batchSize);
                    await prisma.ubigeo.createMany({ data: batch });
                }
                console.log(`   ✅ ${ubigeoData.length} ubigeos seeded`);
            } else {
                console.log('   ⚠️ Ubigeo data files not found, skipping...');
            }
        } else {
            console.log(`   ✅ Ubigeos already exist (${ubigeoCount} records)`);
        }

        // 3. Seed UnidadMedida
        console.log('\n📏 3. Seeding UnidadMedida...');
        const unidades = [
            { codigo: 'NIU', nombre: 'UNIDAD' },
            { codigo: 'KGM', nombre: 'KILOGRAMO' },
            { codigo: 'LTR', nombre: 'LITRO' },
            { codigo: 'MTR', nombre: 'METRO' },
            { codigo: 'BOL', nombre: 'BOLSA' },
            { codigo: 'CAJ', nombre: 'CAJA' },
            { codigo: 'DOC', nombre: 'DOCENA' },
            { codigo: 'PAR', nombre: 'PAR' },
            { codigo: 'JGO', nombre: 'JUEGO' },
            { codigo: 'GAL', nombre: 'GALÓN' },
        ];
        for (const unidad of unidades) {
            await prisma.unidadMedida.upsert({
                where: { codigo: unidad.codigo },
                update: {},
                create: unidad,
            });
        }
        console.log('   ✅ UnidadMedida seeded');

        // 4. Seed Rubro
        console.log('\n🏷️ 4. Seeding Rubro...');
        let rubro = await prisma.rubro.findFirst({ where: { nombre: 'General' } });
        if (!rubro) {
            rubro = await prisma.rubro.create({ data: { nombre: 'General' } });
        }
        console.log('   ✅ Rubro seeded');

        // 5. Seed Plan PRO
        console.log('\n💳 5. Seeding Plan...');
        let plan = await prisma.plan.findFirst({ where: { nombre: 'PRO' } });
        if (!plan) {
            plan = await prisma.plan.create({
                data: {
                    nombre: 'PRO',
                    descripcion: 'Plan Desktop - Sin límites',
                    costo: 0,
                    esPrueba: false,
                    duracionDias: 36500, // 100 años
                    tipoFacturacion: 'PERPETUO',
                    limiteUsuarios: 999,
                    tieneTienda: true,
                    tieneBanners: true,
                    tieneGaleria: true,
                    tieneCulqi: false,
                    tieneDeliveryGPS: false,
                    maxComprobantes: 999999,
                }
            });
        }
        console.log('   ✅ Plan PRO seeded');

        // 6. Seed Default Company
        console.log('\n🏢 6. Seeding Empresa...');
        let empresa = await prisma.empresa.findFirst({ where: { ruc: '20000000001' } });
        if (!empresa) {
            empresa = await prisma.empresa.create({
                data: {
                    ruc: '20000000001',
                    razonSocial: 'MI EMPRESA S.A.C.',
                    direccion: 'Av. Principal 123',
                    fechaActivacion: new Date(),
                    fechaExpiracion: new Date(new Date().setFullYear(new Date().getFullYear() + 100)),
                    planId: plan.id,
                    rubroId: rubro.id,
                    estado: 'ACTIVO',
                    tipoEmpresa: 'FORMAL',
                    slugTienda: 'mi-tienda',
                    colorPrimario: '#6A6CFF',
                    aceptaEfectivo: true,
                }
            });
        }
        console.log('   ✅ Empresa default seeded');

        // 7. Seed Default Client "VARIOS"
        console.log('\n👤 7. Seeding Cliente VARIOS...');
        const tipoDocDNI = await prisma.tipoDocumento.findUnique({ where: { codigo: '1' } });
        if (tipoDocDNI) {
            const clienteVarios = await prisma.cliente.findFirst({
                where: { empresaId: empresa.id, nroDoc: '00000000' }
            });
            if (!clienteVarios) {
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
            }
        }
        console.log('   ✅ Cliente VARIOS seeded');

        // 8. Seed Admin User
        console.log('\n🔐 8. Seeding Usuario Admin...');
        const adminExists = await prisma.usuario.findUnique({ where: { email: 'admin@falconext.com' } });
        if (!adminExists) {
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
        }
        console.log('   ✅ Usuario admin seeded');

        // 9. Seed TipoOperacion (for SUNAT)
        console.log('\n📄 9. Seeding TipoOperacion...');
        const tiposOperacion = [
            { codigo: '0101', descripcion: 'Venta interna' },
            { codigo: '0102', descripcion: 'Venta interna – Anticipos' },
            { codigo: '0200', descripcion: 'Exportación de bienes' },
            { codigo: '0401', descripcion: 'Ventas no domiciliadas que no califican como exportación' },
        ];
        for (const op of tiposOperacion) {
            await prisma.tipoOperacion.upsert({
                where: { codigo: op.codigo },
                update: {},
                create: op,
            });
        }
        console.log('   ✅ TipoOperacion seeded');

        // 10. Seed MotivoNota
        console.log('\n📝 10. Seeding MotivoNota...');
        const motivosCredito = [
            { tipo: 'CREDITO' as const, codigo: '01', descripcion: 'Anulación de la operación' },
            { tipo: 'CREDITO' as const, codigo: '02', descripcion: 'Anulación por error en el RUC' },
            { tipo: 'CREDITO' as const, codigo: '03', descripcion: 'Corrección por error en la descripción' },
            { tipo: 'CREDITO' as const, codigo: '04', descripcion: 'Descuento global' },
            { tipo: 'CREDITO' as const, codigo: '05', descripcion: 'Descuento por ítem' },
            { tipo: 'CREDITO' as const, codigo: '06', descripcion: 'Devolución total' },
            { tipo: 'CREDITO' as const, codigo: '07', descripcion: 'Devolución por ítem' },
            { tipo: 'CREDITO' as const, codigo: '10', descripcion: 'Otros conceptos' },
        ];
        const motivosDebito = [
            { tipo: 'DEBITO' as const, codigo: '01', descripcion: 'Intereses por mora' },
            { tipo: 'DEBITO' as const, codigo: '02', descripcion: 'Aumento en el valor' },
            { tipo: 'DEBITO' as const, codigo: '03', descripcion: 'Penalidades / otros conceptos' },
        ];
        for (const motivo of [...motivosCredito, ...motivosDebito]) {
            const existing = await prisma.motivoNota.findUnique({
                where: { tipo_codigo: { tipo: motivo.tipo, codigo: motivo.codigo } }
            });
            if (!existing) {
                await prisma.motivoNota.create({ data: motivo });
            }
        }
        console.log('   ✅ MotivoNota seeded');

        // 11. Seed Catalog Products (ProductoPlantilla)
        console.log('\n📦 11. Seeding Catálogo de Productos...');
        const catalogPath = path.join(__dirname, '../catalogo_ferreteria_export.json');
        if (fs.existsSync(catalogPath)) {
            const catalogCount = await prisma.productoPlantilla.count();
            if (catalogCount === 0) {
                const catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

                // Get or create rubro for Ferretería
                let rubroFerreteria = await prisma.rubro.findFirst({ where: { nombre: 'Ferretería' } });
                if (!rubroFerreteria) {
                    rubroFerreteria = await prisma.rubro.create({ data: { nombre: 'Ferretería' } });
                }

                let count = 0;
                for (const prod of catalogData) {
                    try {
                        await prisma.productoPlantilla.create({
                            data: {
                                nombre: prod.nombre || 'Sin nombre',
                                descripcion: prod.descripcion || prod.nombre || '',
                                codigo: prod.codigo || `CAT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                                precioSugerido: prod.precioSugerido || 0,
                                imagenUrl: prod.imagenUrl || null,
                                categoria: prod.categoria || null,
                                marca: prod.marca || null,
                                unidadConteo: prod.unidadConteo || 'NIU',
                                rubroId: rubroFerreteria.id,
                            }
                        });
                        count++;
                    } catch (e) {
                        // Ignore duplicates or errors for individual products
                    }
                }
                console.log(`   ✅ ${count} productos de catálogo seeded`);
            } else {
                console.log(`   ✅ Catálogo ya existe (${catalogCount} productos)`);
            }
        } else {
            console.log('   ⚠️ Archivo de catálogo no encontrado, skipping...');
        }

        console.log('\n🎉 ¡Seed completado exitosamente!');
        console.log('🔑 Credenciales: admin@falconext.com / admin123');

    } catch (error) {
        console.error('❌ Error durante el seed:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
