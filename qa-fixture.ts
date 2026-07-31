import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
const prisma = new PrismaClient();
// Réplica EXACTA de las 12 features del rubro 32 en prod
const FEATURES: Record<string, boolean> = {
  controlStock: true, usaCodigoBarras: true, gestionLotes: true, requiereVencimientos: true,
  permiteFraccionamiento: false, gestionOfertas: true, fichaTecnicaComputo: false,
  controlSeriesGarantia: true, descripcionRica: false, usaVariantes: true,
  trazabilidadVehicular: false, gestionContratosVehiculares: false,
};
(async () => {
  const plan = (await prisma.plan.findFirst()) ?? (await prisma.plan.create({ data: { nombre: 'QA' } }));
  const rubro = await prisma.rubro.upsert({ where: { nombre: 'Bazar, Perfumería y accesorios' }, update: {}, create: { nombre: 'Bazar, Perfumería y accesorios' } });
  // Sembrar las RubroFeature igual que prod
  for (const [featureKey, enabled] of Object.entries(FEATURES)) {
    await prisma.rubroFeature.upsert({
      where: { rubroId_featureKey: { rubroId: rubro.id, featureKey } },
      update: { enabledByDefault: enabled },
      create: { rubroId: rubro.id, featureKey, enabledByDefault: enabled },
    });
  }
  const empresa = await prisma.empresa.upsert({ where: { ruc: '20601234567' }, update: { estado: 'ACTIVO', usaCodigoBarrasManual: false, brand: 'krezka', rubroId: rubro.id }, create: { ruc: '20601234567', razonSocial: 'PERFUMERIAS UNIDAS S.A.', direccion: 'X', estado: 'ACTIVO', brand: 'krezka', usaCodigoBarrasManual: false, fechaActivacion: new Date('2026-01-01'), fechaExpiracion: new Date('2030-01-01'), planId: plan.id, rubroId: rubro.id } });
  if (!(await prisma.sede.findFirst({ where: { empresaId: empresa.id } }))) await prisma.sede.create({ data: { empresaId: empresa.id, nombre: 'Tienda Principal', esPrincipal: true, activo: true } });
  await prisma.unidadMedida.upsert({ where: { codigo: 'NIU' }, update: {}, create: { codigo: 'NIU', nombre: 'UNIDAD' } });
  const hashed = await bcrypt.hash('123456', 10);
  await prisma.usuario.upsert({ where: { email: 'demo.perfumeria@gmail.com' }, update: { password: hashed, estado: 'ACTIVO', empresaId: empresa.id, rol: 'ADMIN_EMPRESA' }, create: { nombre: 'Demo Perfumería', dni: '0', celular: '9', email: 'demo.perfumeria@gmail.com', password: hashed, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO', empresaId: empresa.id } });
  console.log('fixture OK: empresa=' + empresa.id + ' brand=krezka rubroFeatures.usaCodigoBarras=true empresa.usaCodigoBarrasManual=false');
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
