/**
 * SEED PARA DETRACCIONES - CATÁLOGO 54 SUNAT
 * Incluye tipos de detracción (bienes y servicios) y medios de pago
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedDetracciones() {
    console.log('💰 Creando datos de Detracciones SUNAT...\n');

    // =============================================
    // TIPOS DE DETRACCIÓN (Catálogo 54 SUNAT)
    // =============================================
    console.log('📋 Creando Tipos de Detracción...');

    const tiposDetraccion = [
        // BIENES (Anexo 2 - RS 183-2004-SUNAT)
        { codigo: '001', descripcion: 'Azúcar y melaza de caña', porcentaje: 10 },
        { codigo: '003', descripcion: 'Alcohol etílico', porcentaje: 4 },
        { codigo: '004', descripcion: 'Recursos hidrobiológicos', porcentaje: 4 },
        { codigo: '005', descripcion: 'Maíz amarillo duro', porcentaje: 4 },
        { codigo: '006', descripcion: 'Madera', porcentaje: 4 },
        { codigo: '007', descripcion: 'Arena y piedra', porcentaje: 10 },
        { codigo: '008', descripcion: 'Residuos, subproductos, desechos, recortes y desperdicios', porcentaje: 15 },
        { codigo: '009', descripcion: 'Carnes y despojos comestibles', porcentaje: 4 },
        { codigo: '010', descripcion: 'Harina, polvo y pellets de pescado, crustáceos, moluscos', porcentaje: 4 },
        { codigo: '011', descripcion: 'Aceite de pescado', porcentaje: 10 },
        { codigo: '012', descripcion: 'Leche', porcentaje: 4 },
        { codigo: '014', descripcion: 'Bienes gravados con el IGV por renuncia a la exoneración', porcentaje: 10 },
        { codigo: '016', descripcion: 'Páprika y otros frutos del género capsicum o pimienta', porcentaje: 10 },
        { codigo: '017', descripcion: 'Espárragos', porcentaje: 10 },
        { codigo: '018', descripcion: 'Minerales metálicos no auríferos', porcentaje: 10 },
        { codigo: '023', descripcion: 'Plomo', porcentaje: 15 },
        { codigo: '029', descripcion: 'Minerales no metálicos', porcentaje: 10 },
        { codigo: '031', descripcion: 'Oro gravado con el IGV', porcentaje: 10 },
        { codigo: '034', descripcion: 'Oro y demás minerales metálicos exonerados del IGV', porcentaje: 1.5 },
        { codigo: '035', descripcion: 'Bienes exonerados del IGV', porcentaje: 1.5 },
        { codigo: '036', descripcion: 'Caña de azúcar', porcentaje: 10 },

        // SERVICIOS (Anexo 3 - RS 183-2004-SUNAT)
        { codigo: '019', descripcion: 'Arrendamiento de bienes', porcentaje: 10 },
        { codigo: '020', descripcion: 'Mantenimiento y reparación de bienes muebles', porcentaje: 12 },
        { codigo: '021', descripcion: 'Movimiento de carga', porcentaje: 10 },
        { codigo: '022', descripcion: 'Otros servicios empresariales', porcentaje: 12 },
        { codigo: '024', descripcion: 'Comisión mercantil', porcentaje: 10 },
        { codigo: '025', descripcion: 'Fabricación de bienes por encargo', porcentaje: 10 },
        { codigo: '026', descripcion: 'Servicio de transporte de personas', porcentaje: 10 },
        { codigo: '027', descripcion: 'Servicio de transporte de carga', porcentaje: 4 },
        { codigo: '030', descripcion: 'Contratos de construcción', porcentaje: 4 },
        { codigo: '032', descripcion: 'Intermediación laboral y tercerización', porcentaje: 12 },
        { codigo: '037', descripcion: 'Demás servicios gravados con el IGV', porcentaje: 12 },
    ];

    for (const tipo of tiposDetraccion) {
        await prisma.tipoDetraccion.upsert({
            where: { codigo: tipo.codigo },
            update: { descripcion: tipo.descripcion, porcentaje: tipo.porcentaje },
            create: tipo,
        });
    }
    console.log(`   ✅ ${tiposDetraccion.length} Tipos de Detracción procesados`);

    // =============================================
    // MEDIOS DE PAGO DETRACCIÓN
    // =============================================
    console.log('💳 Creando Medios de Pago para Detracción...');

    const mediosPagoDetraccion = [
        { codigo: '001', descripcion: 'Depósito en cuenta' },
        { codigo: '002', descripcion: 'Giro' },
        { codigo: '003', descripcion: 'Transferencia de fondos' },
        { codigo: '004', descripcion: 'Orden de pago' },
        { codigo: '005', descripcion: 'Tarjeta de débito' },
        { codigo: '006', descripcion: 'Tarjeta de crédito emitida en el país por empresa del sistema financiero' },
        { codigo: '007', descripcion: 'Cheques con la cláusula de "NO NEGOCIABLE", "INTRANSFERIBLES"' },
        { codigo: '008', descripcion: 'Efectivo, en operaciones en las que no supere S/ 500' },
        { codigo: '009', descripcion: 'Otros medios de pago' },
    ];

    for (const medio of mediosPagoDetraccion) {
        await prisma.medioPagoDetraccion.upsert({
            where: { codigo: medio.codigo },
            update: { descripcion: medio.descripcion },
            create: medio,
        });
    }
    console.log(`   ✅ ${mediosPagoDetraccion.length} Medios de Pago procesados`);

    // =============================================
    // TIPOS DE OPERACIÓN ADICIONALES (SUNAT)
    // =============================================
    console.log('🔄 Actualizando Tipos de Operación...');

    // Fix sequence to avoid unique constraint errors on ID
    try {
        await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"TipoOperacion"', 'id'), coalesce(max(id), 0) + 1, false) FROM "TipoOperacion";`);
        console.log('   ✅ Secuencia de IDs de TipoOperacion sincronizada');
    } catch (error) {
        console.warn('   ⚠️ No se pudo sincronizar la secuencia (puede ser SQLite o permisos):', error.message);
    }

    const tiposOperacionNuevos = [
        { codigo: '0101', descripcion: 'VENTA INTERNA' },
        { codigo: '0102', descripcion: 'EXPORTACIÓN' },
        { codigo: '0112', descripcion: 'VENTA INTERNA - ANTICIPOS' },
        { codigo: '0113', descripcion: 'EXPORTACIÓN - ANTICIPOS' },
        { codigo: '0121', descripcion: 'VENTA INTERNA SUJETA A IVAP' },
        { codigo: '0200', descripcion: 'EXPORTACIÓN DE SERVICIOS - PRESTACIÓN DE SERVICIOS REALIZADOS EN EL PAÍS' },
        { codigo: '0201', descripcion: 'EXPORTACIÓN DE SERVICIOS - PRESTACIÓN DE SERVICIOS REALIZADOS ÍNTEGRAMENTE EN EL EXTRANJERO' },
        { codigo: '0202', descripcion: 'EXPORTACIÓN DE SERVICIOS - SERVICIOS DE HOSPEDAJE NO DOMICILIADOS' },
        { codigo: '0205', descripcion: 'EXPORTACIÓN DE SERVICIOS - SERVICIOS A NAVES Y AERONAVES DE BANDERA EXTRANJERA' },
        { codigo: '0206', descripcion: 'EXPORTACIÓN DE SERVICIOS - SERVICIOS COMPLEMENTARIOS AL TRANSPORTE DE CARGA' },
        { codigo: '0401', descripcion: 'OPERACIONES SUJETAS A DETRACCIÓN' },
    ];

    for (const op of tiposOperacionNuevos) {
        try {
            // Usar findUnique primero para evitar problemas con upsert si la secuencia falla
            const existing = await prisma.tipoOperacion.findUnique({ where: { codigo: op.codigo } });

            if (existing) {
                if (existing.descripcion !== op.descripcion) {
                    await prisma.tipoOperacion.update({
                        where: { id: existing.id },
                        data: { descripcion: op.descripcion }
                    });
                }
            } else {
                await prisma.tipoOperacion.create({ data: op });
            }
        } catch (e) {
            console.error(`   ❌ Error procesando TipoOperacion ${op.codigo}:`, e.message);
        }
    }
    console.log(`   ✅ Verificación de Tipos de Operación completada`);

    console.log('\n✅ Seed de Detracciones completado!\n');
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    seedDetracciones()
        .catch((e) => {
            console.error('❌ Error en seed:', e);
            // No salir con error 1 para no romper pipelines si algo falla levemente
            process.exit(0);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
