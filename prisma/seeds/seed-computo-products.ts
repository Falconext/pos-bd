import { PrismaClient, Prisma, EstadoType } from '@prisma/client';

const prisma = new PrismaClient();

const empresaId = Number(process.env.EMPRESA_ID || 45);
const sedeId = Number(process.env.SEDE_ID || 20);

const products = [
  {
    codigo: 'CMP-TEST-001',
    descripcion: 'Memoria RAM Kingston Fury Beast 8GB DDR4 3200MHz',
    marca: 'KINGSTON',
    categoria: 'Memorias RAM',
    precio: 119,
    costo: 72,
    stock: 18,
    barcode: '7751001000011',
    sku: 'KF432C16BB/8',
    modelo: 'Fury Beast DDR4',
    especificacion: '8GB DDR4 3200MHz CL16',
    garantia: 12,
    tipo: 'Repuesto',
    serializable: true,
  },
  {
    codigo: 'CMP-TEST-002',
    descripcion: 'Memoria RAM Kingston Fury Beast 16GB DDR4 3200MHz',
    marca: 'KINGSTON',
    categoria: 'Memorias RAM',
    precio: 189,
    costo: 128,
    stock: 14,
    barcode: '7751001000028',
    sku: 'KF432C16BB/16',
    modelo: 'Fury Beast DDR4',
    especificacion: '16GB DDR4 3200MHz CL16',
    garantia: 12,
    tipo: 'Repuesto',
    serializable: true,
  },
  {
    codigo: 'CMP-TEST-003',
    descripcion: 'SSD Kingston NV2 500GB M.2 NVMe PCIe 4.0',
    marca: 'KINGSTON',
    categoria: 'Almacenamiento',
    precio: 169,
    costo: 105,
    stock: 20,
    barcode: '7751001000035',
    sku: 'SNV2S/500G',
    modelo: 'NV2',
    especificacion: '500GB M.2 2280 NVMe PCIe 4.0',
    garantia: 12,
    tipo: 'Repuesto',
    serializable: true,
  },
  {
    codigo: 'CMP-TEST-004',
    descripcion: 'SSD Kingston NV2 1TB M.2 NVMe PCIe 4.0',
    marca: 'KINGSTON',
    categoria: 'Almacenamiento',
    precio: 289,
    costo: 198,
    stock: 12,
    barcode: '7751001000042',
    sku: 'SNV2S/1000G',
    modelo: 'NV2',
    especificacion: '1TB M.2 2280 NVMe PCIe 4.0',
    garantia: 12,
    tipo: 'Repuesto',
    serializable: true,
  },
  {
    codigo: 'CMP-TEST-005',
    descripcion: 'Mouse Logitech M185 Inalámbrico USB',
    marca: 'LOGITECH',
    categoria: 'Periféricos',
    precio: 59,
    costo: 34,
    stock: 25,
    barcode: '7751001000059',
    sku: '910-002225',
    modelo: 'M185',
    especificacion: 'Mouse inalámbrico 2.4GHz USB',
    garantia: 6,
    tipo: 'Accesorio',
    serializable: false,
  },
  {
    codigo: 'CMP-TEST-006',
    descripcion: 'Teclado Logitech K120 USB Español',
    marca: 'LOGITECH',
    categoria: 'Periféricos',
    precio: 49,
    costo: 28,
    stock: 22,
    barcode: '7751001000066',
    sku: '920-004422',
    modelo: 'K120',
    especificacion: 'Teclado USB español resistente a derrames',
    garantia: 6,
    tipo: 'Accesorio',
    serializable: false,
  },
  {
    codigo: 'CMP-TEST-007',
    descripcion: 'Fuente EVGA 600W 80 Plus White',
    marca: 'EVGA',
    categoria: 'Fuentes de poder',
    precio: 229,
    costo: 158,
    stock: 8,
    barcode: '7751001000073',
    sku: '100-W1-0600-K1',
    modelo: '600 W1',
    especificacion: '600W ATX 80 Plus White',
    garantia: 12,
    tipo: 'Repuesto',
    serializable: true,
  },
  {
    codigo: 'CMP-TEST-008',
    descripcion: 'Cable HDMI 2.0 UGREEN 2 Metros 4K',
    marca: 'UGREEN',
    categoria: 'Cables y adaptadores',
    precio: 35,
    costo: 16,
    stock: 35,
    barcode: '7751001000080',
    sku: 'HD104-2M',
    modelo: 'HDMI 2.0',
    especificacion: 'Cable HDMI 4K 60Hz 2 metros',
    garantia: 3,
    tipo: 'Accesorio',
    serializable: false,
  },
  {
    codigo: 'CMP-TEST-009',
    descripcion: 'Adaptador USB-C a HDMI UGREEN 4K',
    marca: 'UGREEN',
    categoria: 'Cables y adaptadores',
    precio: 89,
    costo: 52,
    stock: 15,
    barcode: '7751001000097',
    sku: 'CM297',
    modelo: 'USB-C HDMI',
    especificacion: 'Adaptador USB-C a HDMI 4K 30Hz',
    garantia: 6,
    tipo: 'Accesorio',
    serializable: false,
  },
  {
    codigo: 'CMP-TEST-010',
    descripcion: 'Pasta térmica Arctic MX-4 4g',
    marca: 'ARCTIC',
    categoria: 'Mantenimiento',
    precio: 39,
    costo: 21,
    stock: 30,
    barcode: '7751001000103',
    sku: 'ACTCP00002B',
    modelo: 'MX-4',
    especificacion: 'Pasta térmica 4g alta conductividad',
    garantia: 0,
    tipo: 'Consumible',
    serializable: false,
  },
];

async function getUnidadMedidaId() {
  const unidad = await prisma.unidadMedida.findFirst({
    where: { codigo: 'NIU' },
    select: { id: true },
  });
  if (!unidad) throw new Error('No existe unidad NIU.');
  return unidad.id;
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

async function main() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { id: true, razonSocial: true },
  });
  if (!empresa) throw new Error(`No existe empresa ${empresaId}.`);

  const sede = await prisma.sede.findFirst({
    where: { id: sedeId, empresaId },
    select: { id: true, nombre: true },
  });
  if (!sede) throw new Error(`No existe sede ${sedeId} para empresa ${empresaId}.`);

  const unidadMedidaId = await getUnidadMedidaId();
  const sedes = await prisma.sede.findMany({
    where: { empresaId, activo: true },
    select: { id: true },
  });

  let created = 0;
  let updated = 0;

  for (const item of products) {
    const marcaId = await getMarcaId(item.marca);
    const categoriaId = await getCategoriaId(item.categoria);
    const valorUnitario = Number((item.precio / 1.18).toFixed(6));

    const atributosTecnicos = {
      modelo: item.modelo,
      skuFabricante: item.sku,
      especificacionClave: item.especificacion,
      garantiaMeses: item.garantia,
      tipo: item.tipo,
      requiereSerie: item.serializable,
      rubro: 'computo',
    };

    const existing = await prisma.producto.findFirst({
      where: { empresaId, codigo: item.codigo },
      select: { id: true },
    });

    const producto = existing
      ? await prisma.producto.update({
          where: { id: existing.id },
          data: {
            descripcion: item.descripcion,
            categoriaId,
            marcaId,
            unidadMedidaId,
            tipoAfectacionIGV: '10',
            precioUnitario: new Prisma.Decimal(item.precio),
            valorUnitario: new Prisma.Decimal(valorUnitario),
            igvPorcentaje: new Prisma.Decimal(18),
            stock: item.stock,
            stockMinimo: 2,
            stockMaximo: Math.max(item.stock * 2, item.stock + 10),
            codigoBarras: item.barcode,
            costoPromedio: new Prisma.Decimal(item.costo),
            costoFijo: new Prisma.Decimal(0),
            porcentajeVenta: 100,
            porcentajeProvision: 0,
            atributosTecnicos,
            estado: EstadoType.ACTIVO,
          },
          select: { id: true },
        })
      : await prisma.producto.create({
          data: {
            empresaId,
            codigo: item.codigo,
            descripcion: item.descripcion,
            categoriaId,
            marcaId,
            unidadMedidaId,
            tipoAfectacionIGV: '10',
            precioUnitario: new Prisma.Decimal(item.precio),
            valorUnitario: new Prisma.Decimal(valorUnitario),
            igvPorcentaje: new Prisma.Decimal(18),
            stock: item.stock,
            stockMinimo: 2,
            stockMaximo: Math.max(item.stock * 2, item.stock + 10),
            codigoBarras: item.barcode,
            costoPromedio: new Prisma.Decimal(item.costo),
            costoFijo: new Prisma.Decimal(0),
            porcentajeVenta: 100,
            porcentajeProvision: 0,
            atributosTecnicos,
            estado: EstadoType.ACTIVO,
            publicarEnTienda: true,
          },
          select: { id: true },
        });

    if (existing) updated += 1;
    else created += 1;

    for (const currentSede of sedes) {
      await prisma.productoStock.upsert({
        where: {
          productoId_sedeId: {
            productoId: producto.id,
            sedeId: currentSede.id,
          },
        },
        update: {
          stock: currentSede.id === sedeId ? item.stock : 0,
          stockMinimo: 2,
          stockMaximo: Math.max(item.stock * 2, item.stock + 10),
        },
        create: {
          productoId: producto.id,
          sedeId: currentSede.id,
          stock: currentSede.id === sedeId ? item.stock : 0,
          stockMinimo: 2,
          stockMaximo: Math.max(item.stock * 2, item.stock + 10),
        },
      });
    }
  }

  console.log(
    `Productos cómputo listos para ${empresa.razonSocial} / ${sede.nombre}: ${created} creados, ${updated} actualizados.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
