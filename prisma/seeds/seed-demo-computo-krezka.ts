import { PrismaClient, Prisma, EstadoProductoSerie, EstadoType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const demoEmail = process.env.DEMO_EMAIL || 'demo.computo@krezka.com';
const demoPassword = process.env.DEMO_PASSWORD || '123456';
const rubroComputo = 'Ventas de accesorios y repuestos de cómputo';

type ProductSeed = {
  codigo: string;
  descripcion: string;
  descripcionLarga: string;
  marca: string;
  categoria: string;
  precio: number;
  costo: number;
  stock: number;
  barcode: string;
  imagenUrl: string;
  localizacion: string;
  destacado?: boolean;
  serializable: boolean;
  garantiaMeses: number;
  pesoGramos: number;
  atributos: Record<string, string | number | boolean>;
};

const image = {
  laptop: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=80',
  gaming: 'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=900&q=80',
  mac: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80',
  monitor: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=900&q=80',
  accessory: 'https://images.unsplash.com/photo-1625842268584-8f3296236761?auto=format&fit=crop&w=900&q=80',
  component: 'https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?auto=format&fit=crop&w=900&q=80',
};

function laptop(
  codigo: string,
  marca: string,
  modelo: string,
  categoria: string,
  procesador: string,
  ram: string,
  almacenamiento: string,
  pantalla: string,
  graficos: string,
  precio: number,
  costo: number,
  stock: number,
  pesoKg: number,
  dimensionesCm: string,
  extra: Partial<ProductSeed> = {},
): ProductSeed {
  return {
    codigo,
    descripcion: `Laptop ${marca} ${modelo} ${procesador} ${ram} ${almacenamiento}`,
    descripcionLarga: `Laptop ${marca} ${modelo} ideal para tienda demo de cómputo. Incluye ${procesador}, memoria ${ram}, almacenamiento ${almacenamiento}, pantalla ${pantalla}, gráficos ${graficos}, Wi-Fi, Bluetooth, webcam HD y cargador original.`,
    marca,
    categoria,
    precio,
    costo,
    stock,
    barcode: `775220${codigo.replace(/\D/g, '').padStart(7, '0').slice(-7)}`,
    imagenUrl: categoria.includes('Gaming') ? image.gaming : marca === 'APPLE' ? image.mac : image.laptop,
    localizacion: extra.localizacion || `Vitrina laptops ${codigo.slice(-2)}`,
    destacado: extra.destacado,
    serializable: true,
    garantiaMeses: 12,
    pesoGramos: Math.round(pesoKg * 1000),
    atributos: {
      rubro: 'computo',
      tipoProducto: 'Laptop',
      marca,
      modelo,
      procesador,
      memoriaRam: ram,
      almacenamiento,
      pantalla,
      resolucion: pantalla.includes('2.8K') ? '2880 x 1800' : pantalla.includes('QHD') ? '2560 x 1440' : '1920 x 1080',
      graficos,
      sistemaOperativo: marca === 'APPLE' ? 'macOS' : 'Windows 11',
      conectividad: 'Wi-Fi 6 / Bluetooth 5.x',
      puertos: marca === 'APPLE' ? 'Thunderbolt / USB-C / MagSafe' : 'USB-C / USB-A / HDMI / audio 3.5mm',
      color: extra.atributos?.color || 'Gris',
      pesoKg,
      dimensionesCm,
      garantiaMeses: 12,
      requiereSerie: true,
      ...extra.atributos,
    },
  };
}

function item(
  codigo: string,
  descripcion: string,
  marca: string,
  categoria: string,
  precio: number,
  costo: number,
  stock: number,
  serializable: boolean,
  garantiaMeses: number,
  pesoGramos: number,
  dimensionesCm: string,
  atributos: Record<string, string | number | boolean>,
  imagenUrl = image.accessory,
): ProductSeed {
  return {
    codigo,
    descripcion,
    descripcionLarga: `${descripcion}. Producto para tienda virtual de cómputo con especificaciones listas para venta online, garantía y control de inventario.`,
    marca,
    categoria,
    precio,
    costo,
    stock,
    barcode: `775330${codigo.replace(/\D/g, '').padStart(7, '0').slice(-7)}`,
    imagenUrl,
    localizacion: `Almacén cómputo ${codigo.slice(-2)}`,
    serializable,
    garantiaMeses,
    pesoGramos,
    atributos: {
      rubro: 'computo',
      dimensionesCm,
      garantiaMeses,
      requiereSerie: serializable,
      ...atributos,
    },
  };
}

const products: ProductSeed[] = [
  laptop('KZ-LAP-001', 'LENOVO', 'IdeaPad Slim 3 15IAH8', 'Laptops', 'Intel Core i5-12450H', '16GB DDR5', 'SSD 512GB NVMe', '15.6" FHD IPS', 'Intel UHD', 2499, 1980, 8, 1.62, '35.9 x 23.6 x 1.8', { destacado: true }),
  laptop('KZ-LAP-002', 'LENOVO', 'ThinkPad E14 Gen 5', 'Laptops Empresariales', 'Intel Core i7-1355U', '16GB DDR4', 'SSD 512GB NVMe', '14" FHD IPS', 'Intel Iris Xe', 3899, 3150, 5, 1.41, '32.4 x 22.0 x 1.8', { destacado: true, atributos: { color: 'Negro', teclado: 'Resistente a derrames' } }),
  laptop('KZ-LAP-003', 'LENOVO', 'Legion 5 15ARP8', 'Laptops Gaming', 'AMD Ryzen 7 7735HS', '16GB DDR5', 'SSD 1TB NVMe', '15.6" FHD 165Hz', 'NVIDIA RTX 4060 8GB', 5599, 4650, 4, 2.4, '35.9 x 26.2 x 2.6', { destacado: true }),
  laptop('KZ-LAP-004', 'LENOVO', 'Yoga Slim 7 14IRL8', 'Ultrabooks', 'Intel Core i7-1360P', '16GB LPDDR5', 'SSD 1TB NVMe', '14" 2.8K OLED', 'Intel Iris Xe', 4999, 4180, 3, 1.35, '31.2 x 22.1 x 1.5', { atributos: { pantallaTactil: true, color: 'Storm Grey' } }),
  laptop('KZ-LAP-005', 'HP', '15-fd0054la', 'Laptops', 'Intel Core i5-1335U', '16GB DDR4', 'SSD 512GB NVMe', '15.6" FHD', 'Intel Iris Xe', 2699, 2150, 9, 1.59, '35.9 x 23.6 x 1.8', { destacado: true }),
  laptop('KZ-LAP-006', 'HP', 'Pavilion Aero 13', 'Ultrabooks', 'AMD Ryzen 5 7535U', '16GB LPDDR5', 'SSD 512GB NVMe', '13.3" WUXGA', 'AMD Radeon', 3499, 2860, 4, 0.98, '29.8 x 20.9 x 1.7', { atributos: { color: 'Silver', chasis: 'Magnesio aluminio' } }),
  laptop('KZ-LAP-007', 'HP', 'Victus 16-r0073cl', 'Laptops Gaming', 'Intel Core i7-13700H', '16GB DDR5', 'SSD 1TB NVMe', '16.1" FHD 144Hz', 'NVIDIA RTX 4060 8GB', 5999, 4980, 3, 2.3, '36.9 x 25.9 x 2.4', { destacado: true }),
  laptop('KZ-LAP-008', 'HP', 'EliteBook 840 G10', 'Laptops Empresariales', 'Intel Core i7-1355U', '16GB DDR5', 'SSD 512GB NVMe', '14" WUXGA', 'Intel Iris Xe', 5299, 4420, 3, 1.36, '31.5 x 22.4 x 1.9', { atributos: { seguridad: 'TPM / lector huella' } }),
  laptop('KZ-LAP-009', 'DELL', 'Inspiron 15 3530', 'Laptops', 'Intel Core i5-1335U', '16GB DDR4', 'SSD 512GB NVMe', '15.6" FHD 120Hz', 'Intel Iris Xe', 2899, 2290, 7, 1.66, '35.8 x 23.5 x 1.9'),
  laptop('KZ-LAP-010', 'DELL', 'Latitude 5440', 'Laptops Empresariales', 'Intel Core i5-1345U', '16GB DDR4', 'SSD 512GB NVMe', '14" FHD IPS', 'Intel Iris Xe', 4499, 3720, 4, 1.39, '32.1 x 21.2 x 1.9', { atributos: { seguridad: 'TPM / lector smart card opcional' } }),
  laptop('KZ-LAP-011', 'DELL', 'G15 5530', 'Laptops Gaming', 'Intel Core i7-13650HX', '16GB DDR5', 'SSD 1TB NVMe', '15.6" FHD 165Hz', 'NVIDIA RTX 4060 8GB', 6299, 5200, 3, 2.81, '35.7 x 27.4 x 2.7'),
  laptop('KZ-LAP-012', 'DELL', 'XPS 13 Plus 9320', 'Ultrabooks', 'Intel Core i7-1260P', '16GB LPDDR5', 'SSD 1TB NVMe', '13.4" 3.5K OLED', 'Intel Iris Xe', 6999, 5900, 2, 1.26, '29.5 x 19.9 x 1.5', { destacado: true, atributos: { pantallaTactil: true } }),
  laptop('KZ-LAP-013', 'ASUS', 'Vivobook 15 X1504VA', 'Laptops', 'Intel Core i5-1335U', '16GB DDR4', 'SSD 512GB NVMe', '15.6" FHD IPS', 'Intel Iris Xe', 2599, 2050, 9, 1.7, '35.9 x 23.2 x 1.9'),
  laptop('KZ-LAP-014', 'ASUS', 'Zenbook 14 OLED UX3402', 'Ultrabooks', 'Intel Core i7-1360P', '16GB LPDDR5', 'SSD 1TB NVMe', '14" 2.8K OLED 90Hz', 'Intel Iris Xe', 4899, 4050, 4, 1.39, '31.4 x 22.0 x 1.7', { destacado: true }),
  laptop('KZ-LAP-015', 'ASUS', 'TUF Gaming A15 FA507', 'Laptops Gaming', 'AMD Ryzen 7 7735HS', '16GB DDR5', 'SSD 1TB NVMe', '15.6" FHD 144Hz', 'NVIDIA RTX 4060 8GB', 5799, 4800, 4, 2.2, '35.4 x 25.1 x 2.5'),
  laptop('KZ-LAP-016', 'ASUS', 'ROG Strix G16 G614', 'Laptops Gaming', 'Intel Core i9-13980HX', '32GB DDR5', 'SSD 1TB NVMe', '16" QHD 240Hz', 'NVIDIA RTX 4070 8GB', 8999, 7600, 2, 2.5, '35.4 x 26.4 x 3.0', { destacado: true }),
  laptop('KZ-LAP-017', 'ACER', 'Aspire 5 A515-58M', 'Laptops', 'Intel Core i5-1335U', '16GB DDR5', 'SSD 512GB NVMe', '15.6" FHD IPS', 'Intel Iris Xe', 2499, 1990, 10, 1.78, '36.2 x 23.7 x 1.8'),
  laptop('KZ-LAP-018', 'ACER', 'Swift Go 14 OLED', 'Ultrabooks', 'Intel Core Ultra 5 125H', '16GB LPDDR5X', 'SSD 512GB NVMe', '14" 2.8K OLED 90Hz', 'Intel Arc', 4199, 3480, 4, 1.32, '31.3 x 21.8 x 1.5'),
  laptop('KZ-LAP-019', 'ACER', 'Nitro V 15 ANV15', 'Laptops Gaming', 'Intel Core i5-13420H', '16GB DDR5', 'SSD 512GB NVMe', '15.6" FHD 144Hz', 'NVIDIA RTX 4050 6GB', 4299, 3540, 5, 2.1, '36.2 x 23.9 x 2.7'),
  laptop('KZ-LAP-020', 'ACER', 'Predator Helios Neo 16', 'Laptops Gaming', 'Intel Core i7-13700HX', '16GB DDR5', 'SSD 1TB NVMe', '16" WUXGA 165Hz', 'NVIDIA RTX 4060 8GB', 6599, 5450, 3, 2.6, '36.0 x 27.9 x 2.8'),
  laptop('KZ-LAP-021', 'MSI', 'Modern 15 B13M', 'Laptops', 'Intel Core i7-1355U', '16GB DDR4', 'SSD 512GB NVMe', '15.6" FHD IPS', 'Intel Iris Xe', 3299, 2700, 5, 1.7, '35.9 x 24.1 x 1.9'),
  laptop('KZ-LAP-022', 'MSI', 'Thin GF63 12VE', 'Laptops Gaming', 'Intel Core i7-12650H', '16GB DDR4', 'SSD 512GB NVMe', '15.6" FHD 144Hz', 'NVIDIA RTX 4050 6GB', 4599, 3780, 4, 1.86, '35.9 x 25.4 x 2.2'),
  laptop('KZ-LAP-023', 'MSI', 'Katana 15 B13V', 'Laptops Gaming', 'Intel Core i7-13620H', '16GB DDR5', 'SSD 1TB NVMe', '15.6" FHD 144Hz', 'NVIDIA RTX 4060 8GB', 5999, 4980, 3, 2.25, '35.9 x 25.9 x 2.5'),
  laptop('KZ-LAP-024', 'MSI', 'Prestige 14 Evo', 'Ultrabooks', 'Intel Core i7-13700H', '16GB LPDDR5', 'SSD 1TB NVMe', '14" FHD IPS', 'Intel Iris Xe', 5199, 4300, 2, 1.29, '31.4 x 22.7 x 1.7'),
  laptop('KZ-LAP-025', 'APPLE', 'MacBook Air 13 M2', 'MacBooks', 'Apple M2 8-core', '8GB unificada', 'SSD 256GB', '13.6" Liquid Retina', 'GPU Apple 8-core', 4299, 3650, 5, 1.24, '30.4 x 21.5 x 1.1', { destacado: true, atributos: { color: 'Medianoche', bateria: 'Hasta 18 horas' } }),
  laptop('KZ-LAP-026', 'APPLE', 'MacBook Air 15 M3', 'MacBooks', 'Apple M3 8-core', '8GB unificada', 'SSD 512GB', '15.3" Liquid Retina', 'GPU Apple 10-core', 6499, 5550, 3, 1.51, '34.0 x 23.8 x 1.2', { atributos: { color: 'Starlight', bateria: 'Hasta 18 horas' } }),
  laptop('KZ-LAP-027', 'APPLE', 'MacBook Pro 14 M3 Pro', 'MacBooks', 'Apple M3 Pro 11-core', '18GB unificada', 'SSD 512GB', '14.2" Liquid Retina XDR', 'GPU Apple 14-core', 9499, 8200, 2, 1.61, '31.3 x 22.1 x 1.6', { destacado: true, atributos: { color: 'Space Black', bateria: 'Hasta 18 horas' } }),
  laptop('KZ-LAP-028', 'APPLE', 'MacBook Pro 16 M3 Max', 'MacBooks', 'Apple M3 Max 14-core', '36GB unificada', 'SSD 1TB', '16.2" Liquid Retina XDR', 'GPU Apple 30-core', 15999, 13900, 1, 2.14, '35.6 x 24.8 x 1.7', { atributos: { color: 'Space Black', bateria: 'Hasta 22 horas' } }),
  laptop('KZ-LAP-029', 'HUAWEI', 'MateBook D16', 'Laptops', 'Intel Core i5-12450H', '16GB LPDDR4X', 'SSD 512GB NVMe', '16" FHD IPS', 'Intel UHD', 2999, 2460, 4, 1.7, '35.7 x 24.9 x 1.8'),
  laptop('KZ-LAP-030', 'HUAWEI', 'MateBook 14', 'Ultrabooks', 'Intel Core i7-1360P', '16GB LPDDR4X', 'SSD 1TB NVMe', '14" 2K IPS', 'Intel Iris Xe', 4599, 3820, 3, 1.49, '30.7 x 22.3 x 1.6'),
  laptop('KZ-LAP-031', 'MICROSOFT', 'Surface Laptop 5 13.5', 'Ultrabooks', 'Intel Core i5-1235U', '8GB LPDDR5X', 'SSD 512GB', '13.5" PixelSense táctil', 'Intel Iris Xe', 4999, 4200, 2, 1.27, '30.8 x 22.3 x 1.5', { atributos: { pantallaTactil: true, color: 'Platinum' } }),
  laptop('KZ-LAP-032', 'MICROSOFT', 'Surface Laptop Studio 2', 'Workstations Móviles', 'Intel Core i7-13700H', '32GB LPDDR5X', 'SSD 1TB', '14.4" PixelSense 120Hz', 'NVIDIA RTX 4050 6GB', 10999, 9400, 1, 1.98, '32.3 x 23.0 x 2.2', { atributos: { pantallaTactil: true, lapizCompatible: true } }),
  laptop('KZ-LAP-033', 'GIGABYTE', 'AERO 16 OLED', 'Workstations Móviles', 'Intel Core i7-13700H', '32GB DDR5', 'SSD 1TB NVMe', '16" 4K OLED', 'NVIDIA RTX 4070 8GB', 9999, 8450, 2, 2.1, '35.6 x 25.0 x 2.2'),
  laptop('KZ-LAP-034', 'LENOVO', 'ThinkPad P16v Gen 1', 'Workstations Móviles', 'Intel Core i7-13700H', '32GB DDR5', 'SSD 1TB NVMe', '16" WUXGA IPS', 'NVIDIA RTX A1000 6GB', 8699, 7350, 2, 2.2, '36.5 x 26.2 x 2.5', { atributos: { certificacion: 'ISV workstation' } }),
  laptop('KZ-LAP-035', 'HP', 'ZBook Firefly 14 G10', 'Workstations Móviles', 'Intel Core i7-1365U', '32GB DDR5', 'SSD 1TB NVMe', '14" WUXGA IPS', 'NVIDIA RTX A500 4GB', 7999, 6750, 2, 1.45, '31.5 x 22.4 x 2.0', { atributos: { certificacion: 'ISV workstation' } }),
  laptop('KZ-LAP-036', 'DELL', 'Precision 3581', 'Workstations Móviles', 'Intel Core i7-13800H', '32GB DDR5', 'SSD 1TB NVMe', '15.6" FHD IPS', 'NVIDIA RTX A1000 6GB', 8499, 7100, 2, 1.79, '35.7 x 23.4 x 2.2', { atributos: { certificacion: 'ISV workstation' } }),
  item('KZ-MON-037', 'Monitor LG UltraGear 27GN800-B 27 QHD 144Hz', 'LG', 'Monitores', 1399, 1040, 6, true, 12, 5300, '61.4 x 45.4 x 22.5', { tipoProducto: 'Monitor', pantalla: '27 pulgadas IPS', resolucion: '2560 x 1440', tasaRefresco: '144Hz', conectividad: 'HDMI / DisplayPort', color: 'Negro' }, image.monitor),
  item('KZ-MON-038', 'Monitor Samsung Odyssey G5 32 Curvo QHD 165Hz', 'SAMSUNG', 'Monitores', 1599, 1220, 4, true, 12, 5900, '71.0 x 53.3 x 27.2', { tipoProducto: 'Monitor', pantalla: '32 pulgadas VA curvo', resolucion: '2560 x 1440', tasaRefresco: '165Hz', curvatura: '1000R' }, image.monitor),
  item('KZ-MON-039', 'Monitor Dell P2422H 24 IPS FHD Empresarial', 'DELL', 'Monitores', 899, 660, 7, true, 12, 4800, '53.8 x 49.6 x 17.9', { tipoProducto: 'Monitor', pantalla: '24 pulgadas IPS', resolucion: '1920 x 1080', tasaRefresco: '60Hz', ergonomia: 'Altura / giro / pivote' }, image.monitor),
  item('KZ-DOC-040', 'Docking Station USB-C Lenovo ThinkPad Universal 100W', 'LENOVO', 'Accesorios para laptop', 699, 510, 5, true, 12, 340, '17.1 x 8.0 x 3.1', { tipoProducto: 'Dock USB-C', potencia: '100W', puertos: 'HDMI / DisplayPort / USB-A / USB-C / RJ45', compatibilidad: 'Windows / macOS' }),
  item('KZ-DOC-041', 'Hub UGREEN USB-C 6 en 1 HDMI 4K PD 100W', 'UGREEN', 'Accesorios para laptop', 189, 118, 18, false, 6, 110, '12.0 x 3.2 x 1.4', { tipoProducto: 'Hub USB-C', potencia: 'PD 100W', video: 'HDMI 4K 30Hz', puertos: 'USB-A / USB-C / HDMI / SD' }),
  item('KZ-SSD-042', 'SSD Kingston NV2 1TB M.2 NVMe PCIe 4.0', 'KINGSTON', 'Componentes y upgrades', 289, 205, 16, true, 12, 7, '8.0 x 2.2 x 0.3', { tipoProducto: 'SSD M.2', capacidad: '1TB', interfaz: 'PCIe 4.0 NVMe', formato: 'M.2 2280', lectura: 'Hasta 3500 MB/s' }, image.component),
  item('KZ-SSD-043', 'SSD Samsung 990 EVO 2TB M.2 NVMe PCIe 5.0', 'SAMSUNG', 'Componentes y upgrades', 699, 535, 8, true, 24, 9, '8.0 x 2.2 x 0.3', { tipoProducto: 'SSD M.2', capacidad: '2TB', interfaz: 'PCIe 5.0 x2 / 4.0 x4', formato: 'M.2 2280', lectura: 'Hasta 5000 MB/s' }, image.component),
  item('KZ-RAM-044', 'Memoria RAM Kingston Fury Impact 16GB DDR5 5600 SODIMM', 'KINGSTON', 'Componentes y upgrades', 269, 198, 12, true, 12, 12, '6.9 x 3.0 x 0.4', { tipoProducto: 'Memoria RAM', capacidad: '16GB', tipoMemoria: 'DDR5 SODIMM', velocidad: '5600MHz', compatibilidad: 'Laptop' }, image.component),
  item('KZ-RAM-045', 'Memoria RAM Crucial 32GB DDR5 5600 SODIMM', 'CRUCIAL', 'Componentes y upgrades', 459, 345, 9, true, 12, 12, '6.9 x 3.0 x 0.4', { tipoProducto: 'Memoria RAM', capacidad: '32GB', tipoMemoria: 'DDR5 SODIMM', velocidad: '5600MHz', compatibilidad: 'Laptop' }, image.component),
  item('KZ-CHA-046', 'Cargador HP USB-C 65W Original para Laptop', 'HP', 'Cargadores y energía', 179, 110, 15, true, 6, 260, '9.5 x 5.0 x 2.8', { tipoProducto: 'Cargador laptop', potencia: '65W', conector: 'USB-C', entrada: '100-240V', compatibilidad: 'HP / USB-C PD' }),
  item('KZ-CHA-047', 'Cargador Lenovo Slim Tip 65W Original', 'LENOVO', 'Cargadores y energía', 169, 105, 14, true, 6, 280, '10.8 x 4.6 x 2.9', { tipoProducto: 'Cargador laptop', potencia: '65W', conector: 'Slim Tip rectangular', entrada: '100-240V', compatibilidad: 'Lenovo ThinkPad / IdeaPad' }),
  item('KZ-MOU-048', 'Mouse Logitech MX Master 3S Inalámbrico Bluetooth', 'LOGITECH', 'Periféricos', 399, 290, 10, true, 12, 141, '12.5 x 8.4 x 5.1', { tipoProducto: 'Mouse', conectividad: 'Bluetooth / receptor USB', dpi: '8000', bateria: 'Recargable USB-C', color: 'Grafito' }),
  item('KZ-KEY-049', 'Teclado Logitech MX Keys Mini Bluetooth Español', 'LOGITECH', 'Periféricos', 349, 255, 9, true, 12, 506, '29.6 x 13.2 x 2.1', { tipoProducto: 'Teclado', conectividad: 'Bluetooth', distribucion: 'Español', iluminacion: 'Retroiluminado', bateria: 'Recargable USB-C' }),
  item('KZ-BAG-050', 'Mochila Targus CitySmart 15.6 para Laptop', 'TARGUS', 'Accesorios para laptop', 159, 92, 20, false, 6, 690, '45.0 x 32.0 x 14.0', { tipoProducto: 'Mochila laptop', capacidad: '15.6 pulgadas', material: 'Poliéster reforzado', compartimentos: 'Laptop / tablet / accesorios', color: 'Negro' }),
];

async function ensureDemoUser() {
  const usuario = await prisma.usuario.findUnique({
    where: { email: demoEmail },
    select: { id: true, nombre: true, empresaId: true, empresa: { select: { id: true, razonSocial: true, slugTienda: true } } },
  });

  const empresa = usuario?.empresa;

  if (!usuario?.empresaId || !empresa) {
    throw new Error(`No existe el usuario demo ${demoEmail} con empresa asignada.`);
  }

  if (process.env.SKIP_PASSWORD_UPDATE !== '1') {
    const password = await bcrypt.hash(demoPassword, 10);
    await prisma.usuario.update({ where: { id: usuario.id }, data: { password } });
  }

  return { ...usuario, empresa };
}

async function ensureRubroComputo(empresaId: number) {
  const rubro = await prisma.rubro.upsert({
    where: { nombre: rubroComputo },
    update: {},
    create: { nombre: rubroComputo },
    select: { id: true },
  });

  const featureKeys = ['fichaTecnicaComputo', 'controlSeriesGarantia', 'usaCodigoBarras', 'controlStock'];

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
      descripcionTienda: 'Demo Krezka de laptops, monitores, componentes y accesorios de cómputo.',
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

async function ensureSedes(empresaId: number) {
  const sedes = await prisma.sede.findMany({
    where: { empresaId, activo: true },
    orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }],
    select: { id: true, nombre: true, esPrincipal: true },
  });

  if (sedes.length > 0) return sedes;

  const sede = await prisma.sede.create({
    data: {
      empresaId,
      nombre: 'Sede Principal',
      codigo: '001',
      esPrincipal: true,
      activo: true,
    },
    select: { id: true, nombre: true, esPrincipal: true },
  });

  return [sede];
}

async function getMarcaId(empresaId: number, nombre: string) {
  const marca = await prisma.marca.upsert({
    where: { empresaId_nombre: { empresaId, nombre } },
    update: {},
    create: { empresaId, nombre },
    select: { id: true },
  });
  return marca.id;
}

async function getCategoriaId(empresaId: number, nombre: string) {
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

async function upsertProduct(empresaId: number, unidadMedidaId: number, mainSedeId: number, sedeIds: number[], item: ProductSeed) {
  const marcaId = await getMarcaId(empresaId, item.marca);
  const categoriaId = await getCategoriaId(empresaId, item.categoria);
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
      stockMinimo: 2,
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
      stockMinimo: 2,
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
          stockMinimo: 2,
          stockMaximo,
          ubicacion: sedeId === mainSedeId ? item.localizacion : 'Stock remoto',
        },
        create: {
          productoId: producto.id,
          sedeId,
          stock: sedeId === mainSedeId ? item.stock : 0,
          stockMinimo: 2,
          stockMaximo,
          ubicacion: sedeId === mainSedeId ? item.localizacion : 'Stock remoto',
        },
      }),
    ),
  );

  if (item.serializable) {
    const series = Array.from({ length: Math.min(item.stock, 3) }, (_, index) => `${item.codigo}-SN-${String(index + 1).padStart(3, '0')}`);

    await Promise.all(
      series.map((numeroSerie) =>
        prisma.productoSerie.upsert({
          where: { empresaId_numeroSerie: { empresaId, numeroSerie } },
          update: {
            productoId: producto.id,
            sedeId: mainSedeId,
            estado: EstadoProductoSerie.DISPONIBLE,
            garantiaMeses: item.garantiaMeses,
            observacion: 'Demo cómputo Krezka',
          },
          create: {
            empresaId,
            productoId: producto.id,
            sedeId: mainSedeId,
            numeroSerie,
            estado: EstadoProductoSerie.DISPONIBLE,
            garantiaMeses: item.garantiaMeses,
            observacion: 'Demo cómputo Krezka',
          },
        }),
      ),
    );
  }
}

async function main() {
  if (products.length !== 50) {
    throw new Error(`El catálogo demo debe tener 50 productos. Actual: ${products.length}.`);
  }

  const usuario = await ensureDemoUser();
  const empresaId = usuario.empresaId!;

  await ensureRubroComputo(empresaId);

  const unidadMedidaId = await ensureUnidadMedidaId();
  const sedes = await ensureSedes(empresaId);
  const mainSede = sedes.find((sede) => sede.esPrincipal) || sedes[0];
  const sedeIds = sedes.map((sede) => sede.id);

  for (const product of products) {
    await upsertProduct(empresaId, unidadMedidaId, mainSede.id, sedeIds, product);
  }

  console.log(`Catálogo demo cómputo listo: ${products.length} productos publicados para ${usuario.empresa.razonSocial} (${demoEmail}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
