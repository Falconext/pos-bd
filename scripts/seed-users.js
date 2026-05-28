const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de usuarios...');

  try {
    // Verificar si ya existen los datos principales
    const existingAdmin = await prisma.usuario.findUnique({
      where: { email: 'admin@nephi.com' }
    });

    if (existingAdmin) {
      console.log('⚠️ Usuario admin ya existe, saltando...');
    } else {
      // 1. Crear datos maestros básicos
      console.log('📋 Creando datos maestros...');
      
      // Crear ubigeo de Lima
      await prisma.ubigeo.upsert({
        where: { codigo: '150101' },
        update: {},
        create: {
          codigo: '150101',
          departamento: 'LIMA',
          provincia: 'LIMA',
          distrito: 'LIMA'
        }
      });

      // Crear rubro de comercio
      const rubro = await prisma.rubro.upsert({
        where: { nombre: 'COMERCIO AL POR MENOR' },
        update: {},
        create: {
          nombre: 'COMERCIO AL POR MENOR'
        }
      });

      // Crear plan formal
      const planFormal = await prisma.plan.upsert({
        where: {
          nombre_plataforma_producto: {
            nombre: 'Plan Empresarial',
            plataforma: 'falconext',
            producto: 'facturacion'
          }
        },
        update: {},
        create: {
          nombre: 'Plan Empresarial',
          plataforma: 'falconext',
          producto: 'facturacion',
          descripcion: 'Plan para empresas formales con facturación SUNAT',
          limiteUsuarios: 10,
          costo: 50.00,
          esPrueba: false,
          duracionDias: 30,
          tipoFacturacion: 'MENSUAL'
        }
      });

      // Crear plan informal
      const planInformal = await prisma.plan.upsert({
        where: {
          nombre_plataforma_producto: {
            nombre: 'Plan Básico',
            plataforma: 'falconext',
            producto: 'facturacion'
          }
        },
        update: {},
        create: {
          nombre: 'Plan Básico',
          plataforma: 'falconext',
          producto: 'facturacion',
          descripcion: 'Plan para empresas informales',
          limiteUsuarios: 5,
          costo: 20.00,
          esPrueba: false,
          duracionDias: 30,
          tipoFacturacion: 'MENSUAL'
        }
      });

      // Crear tipos de documento
      await prisma.tipoDocumento.upsert({
        where: { codigo: '1' },
        update: {},
        create: {
          codigo: '1',
          descripcion: 'DOCUMENTO NACIONAL DE IDENTIDAD'
        }
      });

      await prisma.tipoDocumento.upsert({
        where: { codigo: '6' },
        update: {},
        create: {
          codigo: '6',
          descripcion: 'REGISTRO ÚNICO DE CONTRIBUYENTES'
        }
      });

      // Crear unidades de medida básicas
      await prisma.unidadMedida.upsert({
        where: { codigo: 'NIU' },
        update: {},
        create: {
          codigo: 'NIU',
          nombre: 'UNIDAD (BIENES)'
        }
      });

      await prisma.unidadMedida.upsert({
        where: { codigo: 'ZZ' },
        update: {},
        create: {
          codigo: 'ZZ',
          nombre: 'UNIDAD (SERVICIOS)'
        }
      });

      // 2. Crear usuario ADMIN_SISTEMA
      console.log('👤 Creando usuario admin del sistema...');
      const hashedAdminPassword = await bcrypt.hash('admin123', 10);
      
      const adminUser = await prisma.usuario.create({
        data: {
          nombre: 'Administrador del Sistema',
          dni: '12345678',
          celular: '999999999',
          email: 'admin@nephi.com',
          password: hashedAdminPassword,
          rol: 'ADMIN_SISTEMA',
          estado: 'ACTIVO',
          telefono: '999999999'
        }
      });

      console.log('✅ Usuario admin creado:', adminUser.email);

      // 3. Crear empresa FORMAL
      console.log('🏢 Creando empresa formal de prueba...');
      const fechaActual = new Date();
      const fechaExpiracion = new Date();
      fechaExpiracion.setDate(fechaActual.getDate() + 30);

      const empresaFormal = await prisma.empresa.create({
        data: {
          ruc: '20123456789',
          razonSocial: 'EMPRESA FORMAL DEMO SAC',
          nombreComercial: 'Empresa Demo',
          direccion: 'AV. LIMA 123, LIMA, LIMA, LIMA',
          tipoEmpresa: 'FORMAL',
          fechaActivacion: fechaActual,
          fechaExpiracion: fechaExpiracion,
          planId: planFormal.id,
          rubroId: rubro.id,
          empresaUbigeo: '150101',
          estado: 'ACTIVO'
        }
      });

      console.log('✅ Empresa formal creada:', empresaFormal.razonSocial);

      // 4. Crear usuario ADMIN_EMPRESA (formal)
      console.log('👤 Creando usuario admin de empresa formal...');
      const hashedEmpresaPassword = await bcrypt.hash('empresa123', 10);
      
      const empresaUser = await prisma.usuario.create({
        data: {
          nombre: 'Diego Ortega',
          dni: '87654321',
          celular: '987654321',
          email: 'diego.ortega.dev@gmail.com',
          password: hashedEmpresaPassword,
          rol: 'ADMIN_EMPRESA',
          empresaId: empresaFormal.id,
          estado: 'ACTIVO',
          telefono: '987654321',
          permisos: JSON.stringify([
            'dashboard',
            'clientes',
            'comprobantes',
            'kardex',
            'reportes',
            'usuarios'
          ])
        }
      });

      console.log('✅ Usuario admin empresa creado:', empresaUser.email);

      // 5. Crear empresa INFORMAL
      console.log('🏪 Creando empresa informal de prueba...');
      const empresaInformal = await prisma.empresa.create({
        data: {
          ruc: '10123456789',
          razonSocial: 'JUAN PEREZ MARTINEZ',
          nombreComercial: 'Bodega Don Juan',
          direccion: 'JR. COMERCIO 456, LIMA, LIMA, LIMA',
          tipoEmpresa: 'INFORMAL',
          fechaActivacion: fechaActual,
          fechaExpiracion: fechaExpiracion,
          planId: planInformal.id,
          rubroId: rubro.id,
          empresaUbigeo: '150101',
          estado: 'ACTIVO'
        }
      });

      console.log('✅ Empresa informal creada:', empresaInformal.razonSocial);

      // 6. Crear usuario para empresa informal
      console.log('👤 Creando usuario de empresa informal...');
      const hashedInformalPassword = await bcrypt.hash('informal123', 10);
      
      const informalUser = await prisma.usuario.create({
        data: {
          nombre: 'Juan Perez Martinez',
          dni: '12348765',
          celular: '912345678',
          email: 'juan.perez@example.com',
          password: hashedInformalPassword,
          rol: 'ADMIN_EMPRESA',
          empresaId: empresaInformal.id,
          estado: 'ACTIVO',
          telefono: '912345678',
          permisos: JSON.stringify([
            'dashboard',
            'clientes',
            'comprobantes',
            'kardex',
            'reportes'
          ])
        }
      });

      console.log('✅ Usuario empresa informal creado:', informalUser.email);

      // 7. Crear productos y categorías básicas para cada empresa
      console.log('📦 Creando categorías y productos básicos...');
      
      // Para empresa formal
      const categoriaFormal = await prisma.categoria.create({
        data: {
          nombre: 'PRODUCTOS GENERALES',
          empresaId: empresaFormal.id
        }
      });

      const unidadNIU = await prisma.unidadMedida.findUnique({
        where: { codigo: 'NIU' }
      });

      await prisma.producto.create({
        data: {
          codigo: 'PROD001',
          descripcion: 'PRODUCTO DEMO 1',
          categoriaId: categoriaFormal.id,
          unidadMedidaId: unidadNIU.id,
          tipoAfectacionIGV: '10',
          precioUnitario: 100.00,
          valorUnitario: 84.75,
          igvPorcentaje: 18.00,
          stock: 100,
          stockMinimo: 10,
          costoPromedio: 70.00,
          empresaId: empresaFormal.id,
          estado: 'ACTIVO'
        }
      });

      // Para empresa informal
      const categoriaInformal = await prisma.categoria.create({
        data: {
          nombre: 'PRODUCTOS DE BODEGA',
          empresaId: empresaInformal.id
        }
      });

      await prisma.producto.create({
        data: {
          codigo: 'BOD001',
          descripcion: 'PRODUCTO BODEGA 1',
          categoriaId: categoriaInformal.id,
          unidadMedidaId: unidadNIU.id,
          tipoAfectacionIGV: '10',
          precioUnitario: 50.00,
          valorUnitario: 42.37,
          igvPorcentaje: 18.00,
          stock: 50,
          stockMinimo: 5,
          costoPromedio: 35.00,
          empresaId: empresaInformal.id,
          estado: 'ACTIVO'
        }
      });

      // 8. Crear cliente "CLIENTES VARIOS" para cada empresa
      console.log('👥 Creando clientes básicos...');
      
      const tipoDocDNI = await prisma.tipoDocumento.findUnique({
        where: { codigo: '1' }
      });

      await prisma.cliente.create({
        data: {
          nombre: 'CLIENTES VARIOS',
          nroDoc: '00000000',
          direccion: 'LIMA, PERU',
          tipoDocumentoId: tipoDocDNI.id,
          empresaId: empresaFormal.id,
          estado: 'ACTIVO',
          persona: 'CLIENTE'
        }
      });

      await prisma.cliente.create({
        data: {
          nombre: 'CLIENTES VARIOS',
          nroDoc: '00000000',
          direccion: 'LIMA, PERU',
          tipoDocumentoId: tipoDocDNI.id,
          empresaId: empresaInformal.id,
          estado: 'ACTIVO',
          persona: 'CLIENTE'
        }
      });

      console.log('✅ Datos básicos creados correctamente');
    }

    console.log('\n🎉 SEED COMPLETADO EXITOSAMENTE');
    console.log('\n📋 USUARIOS CREADOS:');
    console.log('  👤 Admin Sistema: admin@nephi.com / admin123');
    console.log('  🏢 Empresa Formal: diego.ortega.dev@gmail.com / empresa123');
    console.log('  🏪 Empresa Informal: juan.perez@example.com / informal123');
    console.log('\n🔑 Puedes usar cualquiera de estos usuarios para probar el sistema');

  } catch (error) {
    console.error('❌ Error durante el seed:', error);
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
