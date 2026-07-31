const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Creando datos adicionales del sistema...');

  try {
    // Crear tipos de operación
    console.log('📋 Creando tipos de operación...');
    
    const tiposOperacion = [
      { codigo: '0101', descripcion: 'VENTA INTERNA' },
      { codigo: '0200', descripcion: 'EXPORTACIÓN' },
      { codigo: '0401', descripcion: 'VENTA INTERNA - ANTICIPOS' }
    ];

    for (const tipo of tiposOperacion) {
      await prisma.tipoOperacion.upsert({
        where: { codigo: tipo.codigo },
        update: {},
        create: tipo
      });
    }

    // Crear motivos para notas de crédito
    console.log('📋 Creando motivos de notas de crédito...');
    
    const motivosCredito = [
      { tipo: 'CREDITO', codigo: '01', descripcion: 'ANULACION DE LA OPERACION' },
      { tipo: 'CREDITO', codigo: '02', descripcion: 'ANULACION POR ERROR EN EL RUC' },
      { tipo: 'CREDITO', codigo: '03', descripcion: 'CORRECCION POR ERROR EN LA DESCRIPCION' },
      { tipo: 'CREDITO', codigo: '04', descripcion: 'DESCUENTO GLOBAL' },
      { tipo: 'CREDITO', codigo: '05', descripcion: 'DESCUENTO POR ITEM' },
      { tipo: 'CREDITO', codigo: '06', descripcion: 'DEVOLUCION TOTAL' },
      { tipo: 'CREDITO', codigo: '07', descripcion: 'DEVOLUCION POR ITEM' }
    ];

    for (const motivo of motivosCredito) {
      await prisma.motivoNota.upsert({
        where: { 
          tipo_codigo: {
            tipo: motivo.tipo,
            codigo: motivo.codigo
          }
        },
        update: {},
        create: motivo
      });
    }

    // Crear motivos para notas de débito
    console.log('📋 Creando motivos de notas de débito...');
    
    const motivosDebito = [
      { tipo: 'DEBITO', codigo: '01', descripcion: 'INTERES POR MORA' },
      { tipo: 'DEBITO', codigo: '02', descripcion: 'AUMENTO EN EL VALOR' },
      { tipo: 'DEBITO', codigo: '03', descripcion: 'PENALIDADES/OTROS CONCEPTOS' }
    ];

    for (const motivo of motivosDebito) {
      await prisma.motivoNota.upsert({
        where: { 
          tipo_codigo: {
            tipo: motivo.tipo,
            codigo: motivo.codigo
          }
        },
        update: {},
        create: motivo
      });
    }

    // Crear más unidades de medida
    console.log('📋 Creando más unidades de medida...');
    
    const unidades = [
      { codigo: 'KGM', nombre: 'KILOGRAMO' },
      { codigo: 'LTR', nombre: 'LITRO' },
      { codigo: 'MTR', nombre: 'METRO' },
      { codigo: 'M2', nombre: 'METRO CUADRADO' },
      { codigo: 'SET', nombre: 'JUEGO' },
      { codigo: 'DOZ', nombre: 'DOCENA' },
      { codigo: 'PQT', nombre: 'PAQUETE' },
      { codigo: 'GLL', nombre: 'GALONES' }
    ];

    for (const unidad of unidades) {
      await prisma.unidadMedida.upsert({
        where: { codigo: unidad.codigo },
        update: {},
        create: unidad
      });
    }

    // Crear más rubros
    console.log('📋 Creando más rubros...');
    
    const rubros = [
      'RESTAURANTES Y SERVICIOS DE COMIDA',
      'SERVICIOS PROFESIONALES',
      'CONSTRUCCION',
      'TRANSPORTE',
      'TECNOLOGIA',
      'SALUD',
      'EDUCACION',
      'MANUFACTURA'
    ];

    for (const nombreRubro of rubros) {
      await prisma.rubro.upsert({
        where: { nombre: nombreRubro },
        update: {},
        create: { nombre: nombreRubro }
      });
    }

    // Crear más tipos de documento
    console.log('📋 Creando más tipos de documento...');
    
    const tiposDoc = [
      { codigo: '4', descripcion: 'CARNET DE EXTRANJERIA' },
      { codigo: '7', descripcion: 'PASAPORTE' },
      { codigo: '11', descripcion: 'PARTIDA DE NACIMIENTO' },
      { codigo: '0', descripcion: 'OTROS TIPOS DE DOCUMENTOS' }
    ];

    for (const tipoDoc of tiposDoc) {
      await prisma.tipoDocumento.upsert({
        where: { codigo: tipoDoc.codigo },
        update: {},
        create: tipoDoc
      });
    }

    console.log('✅ Datos adicionales creados correctamente');
    console.log('\n🎉 DATOS ADICIONALES COMPLETADOS');
    console.log('✅ Tipos de operación, motivos de notas, unidades de medida y rubros creados');

  } catch (error) {
    console.error('❌ Error durante la creación de datos adicionales:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });