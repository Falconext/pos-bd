import { PrismaClient, Prisma, EstadoType } from '@prisma/client';

const prisma = new PrismaClient();

const empresaId = Number(process.env.EMPRESA_ID || 19);
const rubroNombre = process.env.RUBRO_NOMBRE || 'Variantes avanzadas para moda';

type ModaSeed = {
  codigo: string;
  descripcion: string;
  marca: string;
  categoria: string;
  precio: number;
  costo: number;
  colors: string[];
  sizes: string[];
  image: string;
  destacado?: boolean;
  pesoGramos: number;
  descripcionLarga: string;
};

const colorImages: Record<string, string> = {
  Negro: 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=900&q=80',
  Blanco: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80',
  Beige: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80',
  Azul: 'https://images.unsplash.com/photo-1523398002811-999ca8dec234?auto=format&fit=crop&w=900&q=80',
  Rojo: 'https://images.unsplash.com/photo-1506629905607-d9f297d05d30?auto=format&fit=crop&w=900&q=80',
  Verde: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=900&q=80',
  Marrón: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80',
  Rosa: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80',
  Gris: 'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=900&q=80',
  Camel: 'https://images.unsplash.com/photo-1562157873-818bc0726f68?auto=format&fit=crop&w=900&q=80',
  Denim: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=900&q=80',
  Dorado: 'https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=900&q=80',
};

const clothesSizes = ['S', 'M', 'L', 'XL'];
const shoeSizes = ['36', '37', '38', '39', '40', '41', '42'];
const uniqueSize = ['Única'];

function moda(
  index: number,
  descripcion: string,
  marca: string,
  categoria: string,
  precio: number,
  costo: number,
  colors: string[],
  sizes: string[],
  pesoGramos: number,
  destacado = false,
): ModaSeed {
  const codigo = `MOD-${String(index).padStart(3, '0')}`;
  const image = colorImages[colors[0]] || colorImages.Negro;
  return {
    codigo,
    descripcion,
    marca,
    categoria,
    precio,
    costo,
    colors,
    sizes,
    image,
    destacado,
    pesoGramos,
    descripcionLarga: `<h2>${descripcion}</h2><p>Producto de moda con variantes avanzadas por color y talla. Ideal para tienda virtual: permite seleccionar presentación, ver disponibilidad real y comprar la variante correcta.</p><ul><li>Material premium según categoría</li><li>Stock independiente por variante</li><li>Imagen asignada por color</li><li>Cambio sujeto a disponibilidad</li></ul>`,
  };
}

const products: ModaSeed[] = [
  moda(1, 'Polo básico algodón premium cuello redondo', 'Krezka Basics', 'Ropa - Polos', 49.9, 23, ['Negro', 'Blanco', 'Beige'], clothesSizes, 220, true),
  moda(2, 'Polo oversize urbano algodón peinado', 'Urban Fit', 'Ropa - Polos', 69.9, 34, ['Negro', 'Blanco', 'Gris'], clothesSizes, 280, true),
  moda(3, 'Polo manga larga rib acanalado', 'Lima Mode', 'Ropa - Polos', 59.9, 29, ['Beige', 'Rosa', 'Negro'], clothesSizes, 240),
  moda(4, 'Top crop casual stretch', 'Boutique 21', 'Ropa - Tops', 45.9, 21, ['Blanco', 'Negro', 'Rojo'], ['XS', 'S', 'M', 'L'], 160),
  moda(5, 'Blusa satinada manga larga', 'Eleganza', 'Ropa - Blusas', 89.9, 45, ['Blanco', 'Rosa', 'Negro'], clothesSizes, 260, true),
  moda(6, 'Blusa lino fresca cuello camisero', 'Lino Vivo', 'Ropa - Blusas', 99.9, 52, ['Beige', 'Blanco', 'Verde'], clothesSizes, 300),
  moda(7, 'Camisa oxford clásica fit regular', 'Krezka Men', 'Ropa - Camisas', 109.9, 58, ['Blanco', 'Azul', 'Negro'], ['S', 'M', 'L', 'XL', 'XXL'], 340, true),
  moda(8, 'Camisa denim casual manga larga', 'Denim Club', 'Ropa - Camisas', 119.9, 63, ['Denim', 'Negro'], ['S', 'M', 'L', 'XL'], 420),
  moda(9, 'Jean skinny tiro alto stretch', 'Denim Club', 'Ropa - Jeans', 129.9, 72, ['Denim', 'Negro', 'Azul'], ['26', '28', '30', '32', '34'], 620, true),
  moda(10, 'Jean mom fit vintage denim', 'Denim Club', 'Ropa - Jeans', 139.9, 78, ['Denim', 'Azul', 'Negro'], ['26', '28', '30', '32', '34'], 680),
  moda(11, 'Pantalón palazzo tela fluida', 'Lima Mode', 'Ropa - Pantalones', 119.9, 62, ['Negro', 'Beige', 'Verde'], clothesSizes, 520, true),
  moda(12, 'Pantalón chino slim hombre', 'Krezka Men', 'Ropa - Pantalones', 129.9, 70, ['Beige', 'Negro', 'Azul'], ['30', '32', '34', '36', '38'], 560),
  moda(13, 'Short denim high waist', 'Denim Club', 'Ropa - Shorts', 79.9, 39, ['Denim', 'Negro', 'Blanco'], ['26', '28', '30', '32'], 360),
  moda(14, 'Short lino verano con pretina', 'Lino Vivo', 'Ropa - Shorts', 69.9, 34, ['Beige', 'Blanco', 'Verde'], clothesSizes, 300),
  moda(15, 'Vestido midi floral primavera', 'Boutique 21', 'Ropa - Vestidos', 159.9, 86, ['Rosa', 'Verde', 'Beige'], ['S', 'M', 'L'], 480, true),
  moda(16, 'Vestido negro cocktail elegante', 'Eleganza', 'Ropa - Vestidos', 189.9, 105, ['Negro', 'Rojo'], ['S', 'M', 'L', 'XL'], 520, true),
  moda(17, 'Falda plisada midi', 'Lima Mode', 'Ropa - Faldas', 99.9, 50, ['Negro', 'Beige', 'Rosa'], clothesSizes, 420),
  moda(18, 'Falda denim mini clásica', 'Denim Club', 'Ropa - Faldas', 89.9, 46, ['Denim', 'Negro'], ['26', '28', '30', '32'], 380),
  moda(19, 'Casaca denim oversize', 'Denim Club', 'Ropa - Casacas', 179.9, 98, ['Denim', 'Negro', 'Blanco'], ['S', 'M', 'L', 'XL'], 920, true),
  moda(20, 'Casaca bomber urbana', 'Urban Fit', 'Ropa - Casacas', 199.9, 112, ['Negro', 'Verde', 'Beige'], ['S', 'M', 'L', 'XL'], 860),
  moda(21, 'Polera hoodie fleece unisex', 'Urban Fit', 'Ropa - Poleras', 149.9, 82, ['Negro', 'Gris', 'Beige'], ['S', 'M', 'L', 'XL'], 720, true),
  moda(22, 'Polera cropped con capucha', 'Boutique 21', 'Ropa - Poleras', 129.9, 68, ['Rosa', 'Blanco', 'Negro'], ['XS', 'S', 'M', 'L'], 600),
  moda(23, 'Conjunto jogger deportivo unisex', 'Urban Fit', 'Ropa - Conjuntos', 219.9, 126, ['Negro', 'Gris', 'Azul'], ['S', 'M', 'L', 'XL'], 1100, true),
  moda(24, 'Legging deportivo compresión media', 'Active Pro', 'Ropa - Deportivo', 89.9, 43, ['Negro', 'Azul', 'Verde'], ['XS', 'S', 'M', 'L'], 260),
  moda(25, 'Top deportivo soporte medio', 'Active Pro', 'Ropa - Deportivo', 69.9, 31, ['Negro', 'Rosa', 'Blanco'], ['XS', 'S', 'M', 'L'], 180),
  moda(26, 'Zapatilla urbana plataforma mujer', 'Step One', 'Calzado - Zapatillas', 169.9, 92, ['Blanco', 'Negro', 'Rosa'], shoeSizes, 850, true),
  moda(27, 'Zapatilla running ligera unisex', 'Active Pro', 'Calzado - Zapatillas', 189.9, 105, ['Negro', 'Azul', 'Blanco'], shoeSizes, 760, true),
  moda(28, 'Zapatilla casual lona clásica', 'Street Walk', 'Calzado - Zapatillas', 119.9, 62, ['Negro', 'Blanco', 'Rojo'], shoeSizes, 680),
  moda(29, 'Zapato vestir cuero sintético hombre', 'Krezka Men', 'Calzado - Zapatos', 199.9, 116, ['Negro', 'Marrón'], ['39', '40', '41', '42', '43'], 920),
  moda(30, 'Zapato taco bloque elegante', 'Eleganza', 'Calzado - Zapatos', 179.9, 98, ['Negro', 'Beige', 'Rojo'], ['36', '37', '38', '39', '40'], 780, true),
  moda(31, 'Sandalia plana verano', 'Step One', 'Calzado - Sandalias', 89.9, 42, ['Beige', 'Negro', 'Dorado'], ['36', '37', '38', '39', '40'], 420),
  moda(32, 'Sandalia taco corrido casual', 'Eleganza', 'Calzado - Sandalias', 129.9, 69, ['Beige', 'Negro', 'Marrón'], ['36', '37', '38', '39', '40'], 620),
  moda(33, 'Botín urbano cuero sintético', 'Street Walk', 'Calzado - Botines', 219.9, 124, ['Negro', 'Marrón', 'Camel'], ['36', '37', '38', '39', '40'], 980, true),
  moda(34, 'Bota alta moda invierno', 'Eleganza', 'Calzado - Botas', 259.9, 148, ['Negro', 'Marrón'], ['36', '37', '38', '39', '40'], 1250),
  moda(35, 'Cartera tote ejecutiva', 'Lima Bags', 'Carteras', 159.9, 84, ['Negro', 'Beige', 'Marrón'], uniqueSize, 780, true),
  moda(36, 'Cartera crossbody compacta', 'Lima Bags', 'Carteras', 119.9, 60, ['Negro', 'Rosa', 'Camel'], uniqueSize, 460, true),
  moda(37, 'Cartera baguette tendencia', 'Boutique 21', 'Carteras', 129.9, 68, ['Blanco', 'Negro', 'Dorado'], uniqueSize, 420),
  moda(38, 'Bolso shopper grande', 'Lima Bags', 'Carteras', 139.9, 74, ['Beige', 'Negro', 'Verde'], uniqueSize, 690),
  moda(39, 'Mochila urbana fashion', 'Urban Fit', 'Mochilas', 149.9, 79, ['Negro', 'Gris', 'Beige'], uniqueSize, 820),
  moda(40, 'Mochila mini casual', 'Boutique 21', 'Mochilas', 109.9, 55, ['Rosa', 'Negro', 'Blanco'], uniqueSize, 520),
  moda(41, 'Billetera compacta mujer', 'Lima Bags', 'Billeteras', 59.9, 27, ['Negro', 'Rosa', 'Dorado'], uniqueSize, 180),
  moda(42, 'Billetera cuero sintético hombre', 'Krezka Men', 'Billeteras', 69.9, 34, ['Negro', 'Marrón'], uniqueSize, 210),
  moda(43, 'Correa clásica hebilla metálica', 'Krezka Men', 'Accesorios', 49.9, 22, ['Negro', 'Marrón'], ['S', 'M', 'L'], 190),
  moda(44, 'Correa fashion hebilla dorada', 'Eleganza', 'Accesorios', 59.9, 27, ['Negro', 'Beige', 'Dorado'], ['S', 'M', 'L'], 170),
  moda(45, 'Gorra baseball algodón', 'Urban Fit', 'Accesorios', 45.9, 20, ['Negro', 'Blanco', 'Azul'], uniqueSize, 120),
  moda(46, 'Gorro beanie tejido invierno', 'Urban Fit', 'Accesorios', 39.9, 18, ['Negro', 'Gris', 'Beige'], uniqueSize, 95),
  moda(47, 'Chompa tejida cuello redondo', 'Lima Mode', 'Ropa - Chompas', 139.9, 72, ['Beige', 'Negro', 'Rosa'], ['S', 'M', 'L', 'XL'], 540),
  moda(48, 'Cardigan abierto tejido suave', 'Lima Mode', 'Ropa - Chompas', 149.9, 80, ['Beige', 'Gris', 'Negro'], ['S', 'M', 'L'], 580),
  moda(49, 'Enterizo casual tela fluida', 'Boutique 21', 'Ropa - Enterizos', 169.9, 88, ['Negro', 'Verde', 'Beige'], ['S', 'M', 'L'], 620, true),
  moda(50, 'Chaleco sastre moderno', 'Eleganza', 'Ropa - Chalecos', 129.9, 66, ['Negro', 'Beige', 'Blanco'], ['S', 'M', 'L', 'XL'], 420),
];

const token = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 4)
    .toUpperCase();

function variantRows(product: ModaSeed) {
  const rows = product.colors.flatMap((color, colorIndex) =>
    product.sizes.map((size, sizeIndex) => {
      const baseStock = 3 + ((colorIndex + sizeIndex) % 5);
      const priceDelta = size === 'XL' || size === 'XXL' ? 10 : 0;
      return {
        valoresAtributos: { Color: color, Talla: size },
        codigo: `${product.codigo}-${token(color)}-${token(size)}`,
        precioUnitario: product.precio + priceDelta,
        stock: baseStock,
        imagenUrl: colorImages[color] || product.image,
        codigoBarras: `775550${product.codigo.replace(/\D/g, '')}${String(colorIndex + 1)}${String(sizeIndex + 1)}`,
        estado: 'ACTIVO' as const,
      };
    }),
  );
  return rows;
}

async function ensureEmpresa() {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { id: true, razonSocial: true },
  });
  if (!empresa) throw new Error(`No existe empresaId ${empresaId}.`);
  return empresa;
}

async function ensureRubro() {
  const rubro = await prisma.rubro.upsert({
    where: { nombre: rubroNombre },
    update: {},
    create: { nombre: rubroNombre },
    select: { id: true },
  });

  await Promise.all(
    ['variantesModa', 'controlStock', 'usaCodigoBarras', 'descripcionRica'].map((featureKey) =>
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
      descripcionTienda: 'Demo de moda con ropa, calzado, carteras y variantes avanzadas por color y talla.',
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

async function syncStocks(productoId: number, mainSedeId: number, sedeIds: number[], stock: number, ubicacion: string) {
  await Promise.all(
    sedeIds.map((sedeId) =>
      prisma.productoStock.upsert({
        where: { productoId_sedeId: { productoId, sedeId } },
        update: {
          stock: sedeId === mainSedeId ? stock : 0,
          stockMinimo: 1,
          stockMaximo: Math.max(stock * 2, stock + 10),
          ubicacion: sedeId === mainSedeId ? ubicacion : 'Stock remoto',
        },
        create: {
          productoId,
          sedeId,
          stock: sedeId === mainSedeId ? stock : 0,
          stockMinimo: 1,
          stockMaximo: Math.max(stock * 2, stock + 10),
          ubicacion: sedeId === mainSedeId ? ubicacion : 'Stock remoto',
        },
      }),
    ),
  );
}

async function upsertModaProduct(unidadMedidaId: number, mainSedeId: number, sedeIds: number[], item: ModaSeed) {
  const marcaId = await getMarcaId(item.marca);
  const categoriaId = await getCategoriaId(item.categoria);
  const variantes = variantRows(item);
  const stockTotal = variantes.reduce((sum, row) => sum + row.stock, 0);
  const valorUnitario = Number((item.precio / 1.18).toFixed(6));

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
      stock: stockTotal,
      stockMinimo: 2,
      stockMaximo: Math.max(stockTotal * 2, stockTotal + 10),
      costoPromedio: new Prisma.Decimal(item.costo),
      costoFijo: new Prisma.Decimal(item.costo),
      porcentajeVenta: 100,
      porcentajeProvision: 0,
      imagenUrl: item.image,
      pesoGramos: new Prisma.Decimal(item.pesoGramos),
      publicarEnTienda: true,
      destacado: Boolean(item.destacado),
      estado: EstadoType.ACTIVO,
      localizacion: `Moda-${item.codigo}`,
      opcionesAtributos: [
        { nombre: 'Color', valores: item.colors },
        { nombre: 'Talla', valores: item.sizes },
      ] as Prisma.InputJsonValue,
      atributosTecnicos: {
        rubro: 'moda',
        tipoProducto: 'Moda con variantes',
        material: 'Textil / sintético según categoría',
        controlVariantes: true,
        variantes: 'Color x Talla',
      },
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
      stock: stockTotal,
      stockMinimo: 2,
      stockMaximo: Math.max(stockTotal * 2, stockTotal + 10),
      costoPromedio: new Prisma.Decimal(item.costo),
      costoFijo: new Prisma.Decimal(item.costo),
      porcentajeVenta: 100,
      porcentajeProvision: 0,
      imagenUrl: item.image,
      pesoGramos: new Prisma.Decimal(item.pesoGramos),
      publicarEnTienda: true,
      destacado: Boolean(item.destacado),
      estado: EstadoType.ACTIVO,
      localizacion: `Moda-${item.codigo}`,
      opcionesAtributos: [
        { nombre: 'Color', valores: item.colors },
        { nombre: 'Talla', valores: item.sizes },
      ] as Prisma.InputJsonValue,
      atributosTecnicos: {
        rubro: 'moda',
        tipoProducto: 'Moda con variantes',
        material: 'Textil / sintético según categoría',
        controlVariantes: true,
        variantes: 'Color x Talla',
      },
    },
    select: { id: true },
  });

  await syncStocks(producto.id, mainSedeId, sedeIds, stockTotal, `Moda-${item.codigo}`);

  for (const variant of variantes) {
    const valorVariante = Number((variant.precioUnitario / 1.18).toFixed(6));
    const variantProduct = await prisma.producto.upsert({
      where: { empresaId_codigo: { empresaId, codigo: variant.codigo } },
      update: {
        productoPadreId: producto.id,
        descripcion: `${item.descripcion} - ${variant.valoresAtributos.Color} / ${variant.valoresAtributos.Talla}`,
        unidadMedidaId,
        tipoAfectacionIGV: '10',
        precioUnitario: new Prisma.Decimal(variant.precioUnitario),
        valorUnitario: new Prisma.Decimal(valorVariante),
        igvPorcentaje: new Prisma.Decimal(18),
        stock: variant.stock,
        categoriaId,
        marcaId,
        imagenUrl: variant.imagenUrl,
        codigoBarras: variant.codigoBarras,
        costoPromedio: new Prisma.Decimal(item.costo),
        costoFijo: new Prisma.Decimal(item.costo),
        porcentajeVenta: 100,
        porcentajeProvision: 0,
        publicarEnTienda: true,
        estado: EstadoType.ACTIVO,
        valoresAtributos: variant.valoresAtributos as Prisma.InputJsonValue,
        localizacion: `Moda-${item.codigo}-${variant.valoresAtributos.Color}`,
      },
      create: {
        empresaId,
        productoPadreId: producto.id,
        codigo: variant.codigo,
        descripcion: `${item.descripcion} - ${variant.valoresAtributos.Color} / ${variant.valoresAtributos.Talla}`,
        unidadMedidaId,
        tipoAfectacionIGV: '10',
        precioUnitario: new Prisma.Decimal(variant.precioUnitario),
        valorUnitario: new Prisma.Decimal(valorVariante),
        igvPorcentaje: new Prisma.Decimal(18),
        stock: variant.stock,
        categoriaId,
        marcaId,
        imagenUrl: variant.imagenUrl,
        codigoBarras: variant.codigoBarras,
        costoPromedio: new Prisma.Decimal(item.costo),
        costoFijo: new Prisma.Decimal(item.costo),
        porcentajeVenta: 100,
        porcentajeProvision: 0,
        publicarEnTienda: true,
        estado: EstadoType.ACTIVO,
        valoresAtributos: variant.valoresAtributos as Prisma.InputJsonValue,
        localizacion: `Moda-${item.codigo}-${variant.valoresAtributos.Color}`,
      },
      select: { id: true },
    });
    await syncStocks(variantProduct.id, mainSedeId, sedeIds, variant.stock, `Moda-${item.codigo}-${variant.valoresAtributos.Color}`);
  }
}

async function main() {
  if (products.length !== 50) {
    throw new Error(`El catálogo moda debe tener 50 productos. Actual: ${products.length}.`);
  }

  const empresa = await ensureEmpresa();
  await ensureRubro();
  const unidadMedidaId = await ensureUnidadMedidaId();
  const sedes = await ensureSedes();
  const mainSede = sedes.find((sede) => sede.esPrincipal) || sedes[0];
  const sedeIds = sedes.map((sede) => sede.id);

  for (const product of products) {
    await upsertModaProduct(unidadMedidaId, mainSede.id, sedeIds, product);
  }

  console.log(`Catálogo moda listo: ${products.length} productos con variantes avanzadas para ${empresa.razonSocial} (empresaId ${empresaId}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
