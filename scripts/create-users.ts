import { PrismaClient, Rol, EstadoType, TipoEmpresa } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function createUsers() {
  try {
    console.log('👥 Creando usuarios básicos...');

    // Crear un plan básico primero
    const plan = await prisma.plan.create({
      data: {
        nombre: 'Plan Básico',
        descripcion: 'Plan básico de prueba',
        limiteUsuarios: 10,
        costo: 0,
        esPrueba: true,
        duracionDias: 365,
        tipoFacturacion: 'MENSUAL'
      }
    });

    // Crear empresa formal
    const empresaFormal = await prisma.empresa.create({
      data: {
        ruc: '20123456789',
        razonSocial: 'EMPRESA FORMAL DEMO SAC',
        direccion: 'AV. EJEMPLO 123, LIMA, LIMA',
        tipoEmpresa: TipoEmpresa.FORMAL,
        fechaActivacion: new Date(),
        fechaExpiracion: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        planId: plan.id,
        estado: EstadoType.ACTIVO,
        nombreComercial: 'EMPRESA DEMO'
      }
    });

    // Crear empresa informal
    const empresaInformal = await prisma.empresa.create({
      data: {
        ruc: '10123456789',
        razonSocial: 'JUAN PEREZ MARTINEZ',
        direccion: 'JR. EJEMPLO 456, LIMA, LIMA',
        tipoEmpresa: TipoEmpresa.INFORMAL,
        fechaActivacion: new Date(),
        fechaExpiracion: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        planId: plan.id,
        estado: EstadoType.ACTIVO,
        nombreComercial: 'JUAN PEREZ'
      }
    });

    // Crear usuarios
    const usuarios = [
      {
        nombre: 'Admin Sistema',
        dni: '12345678',
        celular: '999999999',
        email: 'admin@nephi.com',
        password: await bcrypt.hash('admin123', 12),
        rol: Rol.ADMIN_SISTEMA,
        empresaId: null,
        estado: EstadoType.ACTIVO
      },
      {
        nombre: 'Diego Ortega',
        dni: '87654321',
        celular: '987654321',
        email: 'diego.ortega.dev@gmail.com',
        password: await bcrypt.hash('empresa123', 12),
        rol: Rol.ADMIN_EMPRESA,
        empresaId: empresaFormal.id,
        estado: EstadoType.ACTIVO
      },
      {
        nombre: 'Juan Perez',
        dni: '11223344',
        celular: '966777888',
        email: 'juan.perez@example.com',
        password: await bcrypt.hash('informal123', 12),
        rol: Rol.ADMIN_EMPRESA,
        empresaId: empresaInformal.id,
        estado: EstadoType.ACTIVO
      }
    ];

    for (const userData of usuarios) {
      await prisma.usuario.create({
        data: userData
      });
      console.log(`✅ Usuario creado: ${userData.email}`);
    }

    console.log('\n✅ Usuarios creados exitosamente:');
    console.log('- Admin Sistema: admin@nephi.com / admin123');
    console.log('- Empresa Formal: diego.ortega.dev@gmail.com / empresa123');
    console.log('- Empresa Informal: juan.perez@example.com / informal123');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createUsers();