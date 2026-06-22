import { PrismaClient, Prisma, EstadoType } from '@prisma/client';

const prisma = new PrismaClient();

const empresaId = Number(process.env.EMPRESA_ID || 19);
const rubroAutomotriz = 'Automotriz y repuestos';

type ProductSeed = {
  codigo: string;
  descripcion: string;
  marca: string;
  categoria: string;
  precio: number;
  costo: number;
  stock: number;
  barcode: string;
  imagenUrl: string;
  localizacion: string;
  destacado?: boolean;
  pesoGramos: number;
  descripcionLarga: string;
  atributos: Record<string, string | number | boolean>;
};

const image = {
  filtros: 'https://images.unsplash.com/photo-1625047509168-a7026f36de04?auto=format&fit=crop&w=900&q=80',
  frenos: 'https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&w=900&q=80',
  suspension: 'https://images.unsplash.com/photo-1632823471565-1ecdf5c0d179?auto=format&fit=crop&w=900&q=80',
  lubricantes: 'https://images.unsplash.com/photo-1635764898632-64c7058717f4?auto=format&fit=crop&w=900&q=80',
  electrico: 'https://images.unsplash.com/photo-1606577924006-27d39b132ae2?auto=format&fit=crop&w=900&q=80',
  accesorios: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=80',
};

function product(
  codigo: string,
  descripcion: string,
  marca: string,
  categoria: string,
  precio: number,
  costo: number,
  stock: number,
  pesoGramos: number,
  atributos: Record<string, string | number | boolean>,
  imagenUrl: string,
  destacado = false,
): ProductSeed {
  const numero = codigo.replace(/\D/g, '').padStart(7, '0').slice(-7);

  return {
    codigo,
    descripcion,
    marca,
    categoria,
    precio,
    costo,
    stock,
    pesoGramos,
    imagenUrl,
    destacado,
    barcode: `775440${numero}`,
    localizacion: `Zona ${categoria.slice(0, 3).toUpperCase()}-${codigo.slice(-2)}`,
    descripcionLarga: `${descripcion}. Repuesto automotriz para tienda demo, con compatibilidad, medidas y especificaciones listas para venta online.`,
    atributos: {
      rubro: 'automotriz',
      tipoProducto: categoria,
      unidadVenta: 'Unidad',
      garantiaMeses: categoria.includes('Lubricantes') ? 0 : 6,
      requiereSerie: false,
      ...atributos,
    },
  };
}

const products: ProductSeed[] = [
  product('AUT-001', 'Filtro de aceite Toyota Corolla/Yaris 1.3-1.8', 'SAKURA', 'Filtros', 28, 14, 40, 280, { compatibilidad: 'Toyota Corolla, Yaris, Etios', motor: '1.3 / 1.5 / 1.8 gasolina', codigoOEM: '90915-YZZE1', altoMm: 75, diametroMm: 68, rosca: '3/4-16 UNF' }, image.filtros, true),
  product('AUT-002', 'Filtro de aceite Hyundai/Kia 1.4-1.6', 'MANN-FILTER', 'Filtros', 32, 17, 35, 260, { compatibilidad: 'Hyundai Accent, Kia Rio, Kia Cerato', motor: '1.4 / 1.6 gasolina', codigoOEM: '26300-35505', altoMm: 80, diametroMm: 66, rosca: 'M20x1.5' }, image.filtros, true),
  product('AUT-003', 'Filtro de aceite Nissan Versa/Sentra', 'BOSCH', 'Filtros', 34, 18, 30, 270, { compatibilidad: 'Nissan Versa, Sentra, Tiida', motor: '1.6 / 1.8 gasolina', codigoOEM: '15208-65F0A', altoMm: 66, diametroMm: 69, rosca: 'M20x1.5' }, image.filtros),
  product('AUT-004', 'Filtro de aceite Chevrolet Sail/Aveo', 'FRAM', 'Filtros', 26, 13, 38, 250, { compatibilidad: 'Chevrolet Sail, Aveo, Spark GT', motor: '1.4 / 1.5 gasolina', codigoOEM: '93185674', altoMm: 75, diametroMm: 65, rosca: 'M18x1.5' }, image.filtros),
  product('AUT-005', 'Filtro de aire Toyota Hilux 2.4/2.8 Diesel', 'SAKURA', 'Filtros', 75, 42, 18, 620, { compatibilidad: 'Toyota Hilux, Fortuner', motor: '2.4 / 2.8 diesel', codigoOEM: '17801-0L040', largoMm: 305, anchoMm: 235, altoMm: 56 }, image.filtros, true),
  product('AUT-006', 'Filtro de aire Hyundai Accent/Kia Rio', 'MANN-FILTER', 'Filtros', 49, 27, 26, 410, { compatibilidad: 'Hyundai Accent, Kia Rio', motor: '1.4 / 1.6 gasolina', codigoOEM: '28113-1R100', largoMm: 260, anchoMm: 150, altoMm: 45 }, image.filtros),
  product('AUT-007', 'Filtro de aire Nissan Versa 1.6', 'BOSCH', 'Filtros', 52, 29, 22, 430, { compatibilidad: 'Nissan Versa, March', motor: '1.6 gasolina', codigoOEM: '16546-ED000', largoMm: 245, anchoMm: 170, altoMm: 42 }, image.filtros),
  product('AUT-008', 'Filtro de cabina carbón activo universal compacto', 'WIX', 'Filtros', 45, 25, 25, 220, { compatibilidad: 'Sedanes compactos', material: 'Carbón activo', largoMm: 215, anchoMm: 200, altoMm: 30, funcion: 'Antipolen / olores' }, image.filtros),
  product('AUT-009', 'Filtro de combustible diésel Toyota Hilux', 'SAKURA', 'Filtros', 89, 52, 14, 520, { compatibilidad: 'Toyota Hilux, Fortuner', motor: 'Diesel common rail', codigoOEM: '23390-0L070', altoMm: 128, diametroMm: 85, separadorAgua: true }, image.filtros),
  product('AUT-010', 'Filtro de combustible Hyundai H1 / Porter', 'MANN-FILTER', 'Filtros', 96, 58, 12, 560, { compatibilidad: 'Hyundai H1, Porter', motor: '2.5 CRDi', codigoOEM: '31922-4H001', altoMm: 145, diametroMm: 88, separadorAgua: true }, image.filtros),
  product('AUT-011', 'Pastillas de freno delanteras Toyota Yaris/Corolla', 'BREMBO', 'Frenos', 145, 88, 20, 1400, { compatibilidad: 'Toyota Yaris, Corolla', eje: 'Delantero', material: 'Cerámico bajo polvo', largoMm: 123, altoMm: 50, espesorMm: 16 }, image.frenos, true),
  product('AUT-012', 'Pastillas de freno delanteras Hyundai Accent/Kia Rio', 'BOSCH', 'Frenos', 135, 82, 22, 1320, { compatibilidad: 'Hyundai Accent, Kia Rio', eje: 'Delantero', material: 'Semimetálico', largoMm: 131, altoMm: 58, espesorMm: 17 }, image.frenos),
  product('AUT-013', 'Pastillas de freno delanteras Nissan Versa/Sentra', 'AKEBONO', 'Frenos', 155, 96, 18, 1360, { compatibilidad: 'Nissan Versa, Sentra', eje: 'Delantero', material: 'Cerámico', largoMm: 137, altoMm: 53, espesorMm: 16 }, image.frenos),
  product('AUT-014', 'Disco de freno ventilado Toyota Corolla 255mm', 'BREMBO', 'Frenos', 189, 118, 14, 5200, { compatibilidad: 'Toyota Corolla', eje: 'Delantero', diametroMm: 255, espesorMm: 22, alturaMm: 46, pernos: 4 }, image.frenos, true),
  product('AUT-015', 'Disco de freno ventilado Hyundai Accent 256mm', 'BOSCH', 'Frenos', 175, 109, 14, 5000, { compatibilidad: 'Hyundai Accent, Kia Rio', eje: 'Delantero', diametroMm: 256, espesorMm: 22, alturaMm: 44, pernos: 4 }, image.frenos),
  product('AUT-016', 'Líquido de frenos DOT 4 500ml', 'ATE', 'Frenos', 38, 20, 45, 560, { especificacion: 'DOT 4', contenidoMl: 500, puntoEbullicionSecoC: 260, aplicacion: 'Sistema hidráulico de frenos y embrague' }, image.frenos),
  product('AUT-017', 'Kit zapatas de freno posterior Toyota Hilux', 'BENDIX', 'Frenos', 210, 135, 10, 2800, { compatibilidad: 'Toyota Hilux 2005-2015', eje: 'Posterior', diametroTamborMm: 295, anchoMm: 55, incluyeResortes: false }, image.frenos),
  product('AUT-018', 'Amortiguador delantero Toyota Yaris', 'KYB', 'Suspensión', 289, 185, 12, 4200, { compatibilidad: 'Toyota Yaris 2006-2018', posicion: 'Delantero', lado: 'Izquierdo/Derecho', tipo: 'Gas presurizado', largoExtendidoMm: 520, largoComprimidoMm: 360 }, image.suspension, true),
  product('AUT-019', 'Amortiguador posterior Toyota Yaris', 'KYB', 'Suspensión', 219, 142, 14, 3300, { compatibilidad: 'Toyota Yaris 2006-2018', posicion: 'Posterior', tipo: 'Gas presurizado', largoExtendidoMm: 560, largoComprimidoMm: 355 }, image.suspension),
  product('AUT-020', 'Amortiguador delantero Hyundai Accent', 'MONROE', 'Suspensión', 275, 176, 10, 4300, { compatibilidad: 'Hyundai Accent 2012-2020', posicion: 'Delantero', lado: 'Izquierdo/Derecho', tipo: 'Gas', largoExtendidoMm: 515, largoComprimidoMm: 350 }, image.suspension),
  product('AUT-021', 'Terminal de dirección Toyota Corolla', 'CTR', 'Suspensión', 68, 36, 30, 620, { compatibilidad: 'Toyota Corolla 2008-2019', posicion: 'Exterior', rosca: 'M14x1.5', largoMm: 180, lado: 'Izquierdo/Derecho' }, image.suspension),
  product('AUT-022', 'Rótula inferior Hyundai Accent/Kia Rio', '555', 'Suspensión', 92, 54, 24, 760, { compatibilidad: 'Hyundai Accent, Kia Rio', posicion: 'Inferior', conoMm: 16, pernos: 3, incluyeSeguro: true }, image.suspension),
  product('AUT-023', 'Bieleta estabilizadora Nissan Versa', 'CTR', 'Suspensión', 58, 31, 32, 430, { compatibilidad: 'Nissan Versa, March', posicion: 'Delantera', largoMm: 285, rosca: 'M10x1.25', material: 'Acero' }, image.suspension),
  product('AUT-024', 'Buje de barra estabilizadora Toyota Hilux', 'FEBEST', 'Suspensión', 36, 18, 40, 180, { compatibilidad: 'Toyota Hilux 2016+', posicion: 'Delantero', diametroInteriorMm: 28, material: 'Caucho reforzado' }, image.suspension),
  product('AUT-025', 'Aceite sintético 5W-30 API SP 1 galón', 'MOBIL', 'Lubricantes', 145, 92, 28, 3900, { viscosidad: '5W-30', normaAPI: 'SP', contenido: '1 galón', tipo: 'Sintético', motores: 'Gasolina modernos' }, image.lubricantes, true),
  product('AUT-026', 'Aceite sintético 5W-40 API SN 4 litros', 'CASTROL', 'Lubricantes', 169, 108, 24, 4100, { viscosidad: '5W-40', normaAPI: 'SN', contenido: '4 litros', tipo: 'Sintético', motores: 'Gasolina / turbo' }, image.lubricantes, true),
  product('AUT-027', 'Aceite mineral 20W-50 API SL 1 galón', 'SHELL', 'Lubricantes', 98, 61, 35, 3900, { viscosidad: '20W-50', normaAPI: 'SL', contenido: '1 galón', tipo: 'Mineral', motores: 'Gasolina alto kilometraje' }, image.lubricantes),
  product('AUT-028', 'Aceite diesel 15W-40 API CI-4 1 galón', 'TOTALENERGIES', 'Lubricantes', 118, 74, 30, 3900, { viscosidad: '15W-40', normaAPI: 'CI-4', contenido: '1 galón', tipo: 'Mineral premium', motores: 'Diesel liviano y pesado' }, image.lubricantes),
  product('AUT-029', 'Refrigerante rojo larga vida 1 galón', 'PRESTONE', 'Lubricantes', 55, 31, 36, 3900, { tipoProducto: 'Refrigerante', color: 'Rojo', contenido: '1 galón', tecnologia: 'OAT larga vida', proteccionC: '-37 a 129' }, image.lubricantes),
  product('AUT-030', 'Refrigerante verde concentrado 1 galón', 'PEAK', 'Lubricantes', 49, 28, 34, 3900, { tipoProducto: 'Refrigerante', color: 'Verde', contenido: '1 galón', mezclaRecomendada: '50/50', proteccionCorrosion: true }, image.lubricantes),
  product('AUT-031', 'Fluido ATF Dexron III 1 litro', 'VALVOLINE', 'Lubricantes', 42, 24, 30, 980, { tipoProducto: 'Fluido transmisión', especificacion: 'Dexron III / Mercon', contenido: '1 litro', aplicacion: 'Transmisión automática / dirección hidráulica' }, image.lubricantes),
  product('AUT-032', 'Aceite caja 75W-90 GL-5 1 litro', 'MOTUL', 'Lubricantes', 72, 45, 20, 980, { tipoProducto: 'Aceite transmisión', viscosidad: '75W-90', norma: 'API GL-5', contenido: '1 litro', aplicacion: 'Caja mecánica / diferencial' }, image.lubricantes),
  product('AUT-033', 'Batería automotriz 12V 45Ah NS60', 'BOSCH', 'Eléctrico', 299, 215, 12, 11800, { tipoProducto: 'Batería', voltaje: '12V', capacidadAh: 45, cca: 430, polaridad: 'Derecha', medidasMm: '238 x 129 x 225' }, image.electrico, true),
  product('AUT-034', 'Batería automotriz 12V 65Ah N70', 'ETNA', 'Eléctrico', 389, 285, 10, 15500, { tipoProducto: 'Batería', voltaje: '12V', capacidadAh: 65, cca: 620, polaridad: 'Derecha', medidasMm: '260 x 173 x 225' }, image.electrico),
  product('AUT-035', 'Bujía iridium Toyota/Nissan rosca 14mm', 'NGK', 'Encendido', 52, 31, 48, 55, { tipoProducto: 'Bujía', compatibilidad: 'Toyota, Nissan, Hyundai según motor', materialElectrodo: 'Iridium', rosca: 'M14', gradoTermico: 6, calibracionMm: 1.1 }, image.electrico, true),
  product('AUT-036', 'Bujía cobre estándar rosca 14mm', 'DENSO', 'Encendido', 18, 9, 80, 50, { tipoProducto: 'Bujía', compatibilidad: 'Motores gasolina estándar', materialElectrodo: 'Cobre', rosca: 'M14', calibracionMm: 0.8, llaveMm: 16 }, image.electrico),
  product('AUT-037', 'Bobina de encendido Toyota Yaris/Corolla', 'DELPHI', 'Encendido', 165, 105, 16, 420, { tipoProducto: 'Bobina encendido', compatibilidad: 'Toyota Yaris, Corolla', pines: 4, voltaje: '12V', codigoOEM: '90919-02258' }, image.electrico),
  product('AUT-038', 'Cable de bujías Hyundai Accent 1.5', 'NGK', 'Encendido', 115, 68, 18, 520, { tipoProducto: 'Cable bujías', compatibilidad: 'Hyundai Accent 1.5', cantidadPiezas: 4, material: 'Silicona', resistencia: 'Baja resistencia' }, image.electrico),
  product('AUT-039', 'Foco halógeno H4 12V 60/55W par', 'PHILIPS', 'Iluminación', 48, 27, 42, 90, { tipoProducto: 'Foco halógeno', base: 'H4', voltaje: '12V', potencia: '60/55W', colorK: 3200, cantidad: 'Par' }, image.electrico),
  product('AUT-040', 'Foco LED H7 12V 6000K par', 'OSRAM', 'Iluminación', 149, 89, 20, 220, { tipoProducto: 'Foco LED', base: 'H7', voltaje: '12V', colorK: 6000, lumenes: 8000, cantidad: 'Par' }, image.electrico),
  product('AUT-041', 'Escobillas limpiaparabrisas 16 pulgadas', 'BOSCH', 'Accesorios', 38, 20, 45, 180, { tipoProducto: 'Escobilla', medidaPulgadas: 16, tipo: 'Convencional', adaptadores: 'Universal', material: 'Caucho natural' }, image.accesorios),
  product('AUT-042', 'Escobillas limpiaparabrisas 18 pulgadas', 'BOSCH', 'Accesorios', 42, 23, 40, 190, { tipoProducto: 'Escobilla', medidaPulgadas: 18, tipo: 'Convencional', adaptadores: 'Universal', material: 'Caucho natural' }, image.accesorios),
  product('AUT-043', 'Escobillas limpiaparabrisas 22 pulgadas flat', 'DENSO', 'Accesorios', 58, 34, 32, 230, { tipoProducto: 'Escobilla', medidaPulgadas: 22, tipo: 'Flat blade', adaptadores: 'Universal', material: 'Grafito' }, image.accesorios),
  product('AUT-044', 'Kit emergencia vehicular triángulo + cable + linterna', 'STANLEY', 'Accesorios', 129, 78, 18, 1800, { tipoProducto: 'Kit emergencia', incluye: 'Triángulo, cables, linterna, guantes', uso: 'Auto / camioneta', estuche: true, medidasCm: '32 x 24 x 9' }, image.accesorios, true),
  product('AUT-045', 'Compresor inflador portátil 12V 150 PSI', 'BLACK+DECKER', 'Accesorios', 189, 118, 16, 1350, { tipoProducto: 'Inflador portátil', voltaje: '12V', presionMaxPsi: 150, cableM: 3, incluyeManometro: true }, image.accesorios),
  product('AUT-046', 'Aditivo limpia inyectores gasolina 250ml', 'LIQUI MOLY', 'Lubricantes', 39, 22, 36, 280, { tipoProducto: 'Aditivo combustible', aplicacion: 'Gasolina', contenidoMl: 250, tratamientoLitros: 70, funcion: 'Limpieza de inyectores' }, image.lubricantes),
  product('AUT-047', 'Aditivo limpia inyectores diesel 250ml', 'LIQUI MOLY', 'Lubricantes', 42, 24, 32, 280, { tipoProducto: 'Aditivo combustible', aplicacion: 'Diesel', contenidoMl: 250, tratamientoLitros: 75, funcion: 'Limpieza sistema common rail' }, image.lubricantes),
  product('AUT-048', 'Correa accesorios 6PK1820', 'GATES', 'Motor', 86, 50, 26, 210, { tipoProducto: 'Correa accesorios', medida: '6PK1820', canales: 6, largoMm: 1820, material: 'EPDM', compatibilidad: 'Según medida OEM' }, image.accesorios),
  product('AUT-049', 'Correa distribución 107 dientes Toyota 1NZ/2NZ', 'GATES', 'Motor', 118, 72, 18, 260, { tipoProducto: 'Correa distribución', dientes: 107, perfil: 'Curvilíneo', compatibilidad: 'Toyota 1NZ-FE / 2NZ-FE', anchoMm: 25 }, image.accesorios),
  product('AUT-050', 'Termostato Toyota Corolla/Yaris 82°C', 'AISIN', 'Motor', 95, 58, 20, 180, { tipoProducto: 'Termostato', compatibilidad: 'Toyota Corolla, Yaris', temperaturaAperturaC: 82, diametroMm: 54, incluyeEmpaque: true }, image.accesorios),
];

async function ensureEmpresa() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { id: true, razonSocial: true },
  });

  if (!empresa) throw new Error(`No existe empresaId ${empresaId}.`);

  return empresa;
}

async function ensureRubroAutomotriz() {
  const rubro = await prisma.rubro.upsert({
    where: { nombre: rubroAutomotriz },
    update: {},
    create: { nombre: rubroAutomotriz },
    select: { id: true },
  });

  const featureKeys = ['controlStock', 'usaCodigoBarras', 'gestionLotes'];

  await Promise.all(
    featureKeys.map((featureKey) =>
      prisma.rubroFeature.upsert({
        where: { rubroId_featureKey: { rubroId: rubro.id, featureKey } },
        update: { enabledByDefault: true },
        create: { rubroId: rubro.id, featureKey, enabledByDefault: true, config: {} },
      }),
    ),
  );

  await prisma.empresa.update({
    where: { id: empresaId },
    data: {
      rubroId: rubro.id,
      aceptaEnvio: true,
      aceptaRecojo: true,
      descripcionTienda: 'Demo automotriz con autopartes, filtros, frenos, suspensión, lubricantes y accesorios para vehículos.',
    },
    select: { id: true },
  });
}

async function ensureUnidadMedidaId() {
  const unidad = await prisma.unidadMedida.upsert({
    where: { codigo: 'NIU' },
    update: { nombre: 'Unidad' },
    create: { codigo: 'NIU', nombre: 'Unidad' },
    select: { id: true },
  });
  return unidad.id;
}

async function ensureSedes() {
  const sedes = await prisma.sede.findMany({
    where: { empresaId, activo: true },
    orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }],
    select: { id: true, nombre: true, esPrincipal: true },
  });

  if (sedes.length > 0) return sedes;

  const sede = await prisma.sede.create({
    data: { empresaId, nombre: 'Sede Principal', codigo: '001', esPrincipal: true, activo: true },
    select: { id: true, nombre: true, esPrincipal: true },
  });

  return [sede];
}

async function getMarcaId(nombre: string) {
  const marca = await prisma.marca.upsert({
    where: { empresaId_nombre: { empresaId, nombre } },
    update: {},
    create: { empresaId, nombre },
    select: { id: true },
  });
  return marca.id;
}

async function getCategoriaId(nombre: string) {
  const existing = await prisma.categoria.findFirst({
    where: { empresaId, nombre },
    select: { id: true },
  });

  if (existing) return existing.id;

  const categoria = await prisma.categoria.create({
    data: { empresaId, nombre },
    select: { id: true },
  });
  return categoria.id;
}

async function upsertProduct(unidadMedidaId: number, mainSedeId: number, sedeIds: number[], item: ProductSeed) {
  const marcaId = await getMarcaId(item.marca);
  const categoriaId = await getCategoriaId(item.categoria);
  const valorUnitario = Number((item.precio / 1.18).toFixed(6));
  const stockMaximo = Math.max(item.stock * 2, item.stock + 10);

  const producto = await prisma.producto.upsert({
    where: { empresaId_codigo: { empresaId, codigo: item.codigo } },
    update: {
      descripcion: item.descripcion,
      descripcionLarga: item.descripcionLarga,
      categoriaId,
      marcaId,
      unidadMedidaId,
      tipoAfectacionIGV: '10',
      precioUnitario: new Prisma.Decimal(item.precio),
      valorUnitario: new Prisma.Decimal(valorUnitario),
      igvPorcentaje: new Prisma.Decimal(18),
      stock: item.stock,
      stockMinimo: 3,
      stockMaximo,
      codigoBarras: item.barcode,
      costoPromedio: new Prisma.Decimal(item.costo),
      costoFijo: new Prisma.Decimal(item.costo),
      porcentajeVenta: 100,
      porcentajeProvision: 0,
      atributosTecnicos: item.atributos as Prisma.InputJsonValue,
      localizacion: item.localizacion,
      imagenUrl: item.imagenUrl,
      pesoGramos: new Prisma.Decimal(item.pesoGramos),
      destacado: Boolean(item.destacado),
      publicarEnTienda: true,
      estado: EstadoType.ACTIVO,
    },
    create: {
      empresaId,
      codigo: item.codigo,
      descripcion: item.descripcion,
      descripcionLarga: item.descripcionLarga,
      categoriaId,
      marcaId,
      unidadMedidaId,
      tipoAfectacionIGV: '10',
      precioUnitario: new Prisma.Decimal(item.precio),
      valorUnitario: new Prisma.Decimal(valorUnitario),
      igvPorcentaje: new Prisma.Decimal(18),
      stock: item.stock,
      stockMinimo: 3,
      stockMaximo,
      codigoBarras: item.barcode,
      costoPromedio: new Prisma.Decimal(item.costo),
      costoFijo: new Prisma.Decimal(item.costo),
      porcentajeVenta: 100,
      porcentajeProvision: 0,
      atributosTecnicos: item.atributos as Prisma.InputJsonValue,
      localizacion: item.localizacion,
      imagenUrl: item.imagenUrl,
      pesoGramos: new Prisma.Decimal(item.pesoGramos),
      destacado: Boolean(item.destacado),
      publicarEnTienda: true,
      estado: EstadoType.ACTIVO,
    },
    select: { id: true },
  });

  await Promise.all(
    sedeIds.map((sedeId) =>
      prisma.productoStock.upsert({
        where: { productoId_sedeId: { productoId: producto.id, sedeId } },
        update: {
          stock: sedeId === mainSedeId ? item.stock : 0,
          stockMinimo: 3,
          stockMaximo,
          ubicacion: sedeId === mainSedeId ? item.localizacion : 'Stock remoto',
        },
        create: {
          productoId: producto.id,
          sedeId,
          stock: sedeId === mainSedeId ? item.stock : 0,
          stockMinimo: 3,
          stockMaximo,
          ubicacion: sedeId === mainSedeId ? item.localizacion : 'Stock remoto',
        },
      }),
    ),
  );
}

async function main() {
  if (products.length !== 50) throw new Error(`El catálogo automotriz debe tener 50 productos. Actual: ${products.length}.`);

  const empresa = await ensureEmpresa();
  await ensureRubroAutomotriz();

  const unidadMedidaId = await ensureUnidadMedidaId();
  const sedes = await ensureSedes();
  const mainSede = sedes.find((sede) => sede.esPrincipal) || sedes[0];
  const sedeIds = sedes.map((sede) => sede.id);

  for (const productSeed of products) {
    await upsertProduct(unidadMedidaId, mainSede.id, sedeIds, productSeed);
  }

  console.log(`Catálogo automotriz listo: ${products.length} productos publicados para ${empresa.razonSocial} (empresaId ${empresaId}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
