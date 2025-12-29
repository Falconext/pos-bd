/**
 * SEED COMPLETO PARA DESKTOP
 * Este script debe ejecutarse al instalar la app de escritorio.
 * Incluye todos los datos base necesarios para que el sistema funcione.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function seedDesktop() {
    console.log('🖥️  Iniciando SEED para Desktop...\n');

    // =============================================
    // 1. TIPOS DE DOCUMENTO (SUNAT)
    // =============================================
    console.log('📋 Creando Tipos de Documento...');
    const tiposDocumento = [
        { codigo: '0', descripcion: 'OTROS' },
        { codigo: '1', descripcion: 'DNI' },
        { codigo: '4', descripcion: 'CARNET DE EXTRANJERÍA' },
        { codigo: '6', descripcion: 'RUC' },
        { codigo: '7', descripcion: 'PASAPORTE' },
        { codigo: 'A', descripcion: 'CARNET DE IDENTIDAD' },
    ];
    for (const doc of tiposDocumento) {
        await prisma.tipoDocumento.upsert({
            where: { codigo: doc.codigo },
            update: {},
            create: doc,
        });
    }
    console.log('   ✅ Tipos de Documento OK');

    // =============================================
    // 2. UNIDADES DE MEDIDA (SUNAT)
    // =============================================
    console.log('📏 Creando Unidades de Medida...');
    const unidadesMedida = [
        { codigo: 'NIU', nombre: 'UNIDAD' },
        { codigo: 'KGM', nombre: 'KILOGRAMO' },
        { codigo: 'LTR', nombre: 'LITRO' },
        { codigo: 'MTR', nombre: 'METRO' },
        { codigo: 'MTK', nombre: 'METRO CUADRADO' },
        { codigo: 'MTQ', nombre: 'METRO CÚBICO' },
        { codigo: 'GRM', nombre: 'GRAMO' },
        { codigo: 'TNE', nombre: 'TONELADA' },
        { codigo: 'GLN', nombre: 'GALÓN' },
        { codigo: 'BOX', nombre: 'CAJA' },
        { codigo: 'DZN', nombre: 'DOCENA' },
        { codigo: 'PAR', nombre: 'PAR' },
        { codigo: 'SET', nombre: 'JUEGO' },
        { codigo: 'ZZ', nombre: 'OTROS' },
    ];
    for (const u of unidadesMedida) {
        await prisma.unidadMedida.upsert({
            where: { codigo: u.codigo },
            update: {},
            create: u,
        });
    }
    console.log('   ✅ Unidades de Medida OK');

    // =============================================
    // 3. TIPOS DE OPERACIÓN (SUNAT)
    // =============================================
    console.log('🔄 Creando Tipos de Operación...');
    const tiposOperacion = [
        { codigo: '0101', descripcion: 'VENTA INTERNA' },
        { codigo: '0102', descripcion: 'VENTA INTERNA - ANTICIPOS' },
        { codigo: '0112', descripcion: 'VENTA INTERNA - SUSTENTA TRASLADO DE BIENES' },
        { codigo: '0200', descripcion: 'EXPORTACIÓN DE BIENES' },
        { codigo: '0201', descripcion: 'EXPORTACIÓN DE SERVICIOS' },
        { codigo: '0401', descripcion: 'VENTAS NO DOMICILIADOS' },
    ];
    for (const op of tiposOperacion) {
        await prisma.tipoOperacion.upsert({
            where: { codigo: op.codigo },
            update: {},
            create: op,
        });
    }
    console.log('   ✅ Tipos de Operación OK');

    // =============================================
    // 4. MOTIVOS DE NOTA (Crédito/Débito - SUNAT)
    // =============================================
    console.log('📝 Creando Motivos de Nota...');
    const motivosCredito = [
        { tipo: 'CREDITO', codigo: '01', descripcion: 'ANULACIÓN DE LA OPERACIÓN' },
        { tipo: 'CREDITO', codigo: '02', descripcion: 'ANULACIÓN POR ERROR EN EL RUC' },
        { tipo: 'CREDITO', codigo: '03', descripcion: 'CORRECCIÓN POR ERROR EN LA DESCRIPCIÓN' },
        { tipo: 'CREDITO', codigo: '04', descripcion: 'DESCUENTO GLOBAL' },
        { tipo: 'CREDITO', codigo: '05', descripcion: 'DESCUENTO POR ÍTEM' },
        { tipo: 'CREDITO', codigo: '06', descripcion: 'DEVOLUCIÓN TOTAL' },
        { tipo: 'CREDITO', codigo: '07', descripcion: 'DEVOLUCIÓN POR ÍTEM' },
        { tipo: 'CREDITO', codigo: '08', descripcion: 'BONIFICACIÓN' },
        { tipo: 'CREDITO', codigo: '09', descripcion: 'DISMINUCIÓN EN EL VALOR' },
        { tipo: 'CREDITO', codigo: '10', descripcion: 'OTROS CONCEPTOS' },
        { tipo: 'CREDITO', codigo: '13', descripcion: 'AJUSTE MYPE' },
    ];
    const motivosDebito = [
        { tipo: 'DEBITO', codigo: '01', descripcion: 'INTERESES POR MORA' },
        { tipo: 'DEBITO', codigo: '02', descripcion: 'AUMENTO EN EL VALOR' },
        { tipo: 'DEBITO', codigo: '03', descripcion: 'PENALIDADES/OTROS CONCEPTOS' },
    ];
    for (const m of [...motivosCredito, ...motivosDebito]) {
        const existing = await prisma.motivoNota.findFirst({
            where: { tipo: m.tipo as any, codigo: m.codigo },
        });
        if (!existing) {
            await prisma.motivoNota.create({ data: m as any });
        }
    }
    console.log('   ✅ Motivos de Nota OK');

    // =============================================
    // 5. RUBROS
    // =============================================
    console.log('🏪 Creando Rubros...');
    const rubros = [
        { nombre: 'Comercio General', descripcion: 'Tiendas de productos variados' },
        { nombre: 'Bodega', descripcion: 'Abarrotes y productos de primera necesidad' },
        { nombre: 'Ferretería', descripcion: 'Materiales de construcción y herramientas' },
        { nombre: 'Farmacia', descripcion: 'Productos farmacéuticos y de salud' },
        { nombre: 'Restaurante', descripcion: 'Servicios de alimentación' },
        { nombre: 'Librería', descripcion: 'Útiles escolares y de oficina' },
        { nombre: 'Lavandería', descripcion: 'Servicios de lavado y planchado' },
    ];
    for (const r of rubros) {
        await prisma.rubro.upsert({
            where: { nombre: r.nombre },
            update: {},
            create: r,
        });
    }
    console.log('   ✅ Rubros OK');

    // =============================================
    // 6. PLAN DESKTOP (Ilimitado local)
    // =============================================
    console.log('📦 Creando Plan Desktop...');
    await prisma.plan.upsert({
        where: { nombre: 'DESKTOP_LOCAL' },
        update: {},
        create: {
            nombre: 'DESKTOP_LOCAL',
            descripcion: 'Plan Desktop - Uso local ilimitado',
            costo: 0,
            esPrueba: false,
            limiteUsuarios: 99,
            duracionDias: 36500, // 100 años
            tipoFacturacion: 'LOCAL',
            tieneTienda: false,
            maxComprobantes: 999999,
        },
    });
    console.log('   ✅ Plan Desktop OK');

    // =============================================
    // 7. EMPRESA DEFAULT + USUARIO ADMIN
    // =============================================
    console.log('🏢 Creando Empresa y Usuario por defecto...');

    const planDesktop = await prisma.plan.findUnique({ where: { nombre: 'DESKTOP_LOCAL' } });
    const rubroDefault = await prisma.rubro.findFirst({ where: { nombre: 'Comercio General' } });

    let empresa = await prisma.empresa.findFirst({ where: { ruc: '00000000000' } });
    if (!empresa) {
        empresa = await prisma.empresa.create({
            data: {
                ruc: '00000000000',
                razonSocial: 'MI NEGOCIO',
                nombreComercial: 'Mi Negocio',
                direccion: 'Dirección por configurar',
                tipoEmpresa: 'FORMAL',
                estado: 'ACTIVO',
                planId: planDesktop?.id || 1,
                rubroId: rubroDefault?.id || 1,
                fechaActivacion: new Date(),
                fechaExpiracion: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
            },
        });
        console.log('   ✅ Empresa creada: MI NEGOCIO');
    }

    const hashedPassword = await bcrypt.hash('admin123', 10);
    await prisma.usuario.upsert({
        where: { email: 'admin@minegocio.local' },
        update: {},
        create: {
            nombre: 'Administrador',
            dni: '00000000',
            celular: '999999999',
            email: 'admin@minegocio.local',
            password: hashedPassword,
            rol: 'ADMIN_EMPRESA',
            estado: 'ACTIVO',
            empresaId: empresa.id,
            permisos: '["*"]',
        },
    });
    console.log('   ✅ Usuario Admin: admin@minegocio.local / admin123');

    // =============================================
    // 8. CLIENTE GENÉRICO
    // =============================================
    console.log('👤 Creando Cliente Genérico...');
    const tipoDNI = await prisma.tipoDocumento.findUnique({ where: { codigo: '1' } });
    await prisma.cliente.upsert({
        where: { id: 1 },
        update: {},
        create: {
            id: 1,
            nombre: 'CLIENTE VARIOS',
            nroDoc: '00000000',
            tipoDocumentoId: tipoDNI?.id,
            empresaId: empresa.id,
            estado: 'ACTIVO',
        },
    });
    console.log('   ✅ Cliente Genérico OK');

    // =============================================
    // 9. CATÁLOGO GLOBAL (ProductoPlantilla)
    // =============================================
    console.log('📚 Cargando Catálogo Global...');

    // Intentar cargar desde JSON exportado
    const catalogPath = path.join(__dirname, '../catalogo_ferreteria_export.json');
    if (fs.existsSync(catalogPath)) {
        const catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
        const rubroFerreteria = await prisma.rubro.findFirst({ where: { nombre: 'Ferretería' } });

        let count = 0;
        for (const p of catalogData) {
            const codigo = p.codigo || `CAT-${count}`;
            await prisma.productoPlantilla.upsert({
                where: { codigo },
                update: {},
                create: {
                    nombre: p.nombre,
                    descripcion: p.descripcion,
                    codigo,
                    precioSugerido: p.precioSugerido,
                    imagenUrl: p.imagenUrl,
                    categoria: p.categoria,
                    marca: p.marca,
                    unidadConteo: p.unidadConteo || 'NIU',
                    rubroId: rubroFerreteria?.id || 1,
                },
            });
            count++;
        }
        console.log(`   ✅ Catálogo cargado: ${count} productos desde JSON`);
    } else {
        // Catálogo mínimo de ejemplo si no hay JSON
        const catalogoEjemplo = [
            { nombre: 'Cemento Sol 42.5kg', precioSugerido: 28.50, unidadConteo: 'NIU' },
            { nombre: 'Fierro Corrugado 1/2"', precioSugerido: 45.00, unidadConteo: 'NIU' },
            { nombre: 'Ladrillo King Kong', precioSugerido: 1.20, unidadConteo: 'NIU' },
            { nombre: 'Pintura Látex Blanco', precioSugerido: 45.00, unidadConteo: 'GLN' },
        ];
        const rubroFerreteria = await prisma.rubro.findFirst({ where: { nombre: 'Ferretería' } });
        for (const p of catalogoEjemplo) {
            await prisma.productoPlantilla.create({
                data: { ...p, rubroId: rubroFerreteria?.id || 1 },
            });
        }
        console.log('   ✅ Catálogo de ejemplo cargado (4 productos)');
    }

    console.log('\n🎉 SEED DESKTOP COMPLETADO EXITOSAMENTE!\n');
    console.log('═══════════════════════════════════════════');
    console.log('  Usuario: admin@minegocio.local');
    console.log('  Contraseña: admin123');
    console.log('═══════════════════════════════════════════\n');
}

seedDesktop()
    .catch((e) => {
        console.error('❌ Error en seed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
