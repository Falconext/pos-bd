
import { PrismaClient } from '@prisma/client';

export const catalogoBodega = [
    { nombre: 'Arroz Costeño Extra 750g', descripcion: 'Arroz superior, bolsa de 750g', precioSugerido: 4.50, unidadConteo: 'NIU' },
    { nombre: 'Azúcar Rubia Cartavio 1kg', descripcion: 'Azúcar rubia doméstica', precioSugerido: 3.80, unidadConteo: 'NIU' },
    { nombre: 'Leche Gloria Azul 400g', descripcion: 'Leche evaporada entera', precioSugerido: 4.20, unidadConteo: 'NIU' },
    { nombre: 'Aceite Primor 1L', descripcion: 'Aceite vegetal botella 1 litro', precioSugerido: 12.50, unidadConteo: 'NIU' },
    { nombre: 'Coca Cola 500ml', descripcion: 'Gaseosa sabor original', precioSugerido: 3.00, unidadConteo: 'NIU' },
    { nombre: 'Inca Kola 1.5L', descripcion: 'La bebida del Perú', precioSugerido: 7.50, unidadConteo: 'NIU' },
    { nombre: 'Galleta Soda San Jorge', descripcion: 'Paquete familiar', precioSugerido: 2.50, unidadConteo: 'NIU' },
    { nombre: 'Atún Florida Filete', descripcion: 'Filete de atún en aceite', precioSugerido: 6.50, unidadConteo: 'NIU' },
];

export const catalogoFerreteria = [
    { nombre: 'Cemento Sol 42.5kg', descripcion: 'Cemento Portland Tipo I', precioSugerido: 28.50, unidadConteo: 'NIU' },
    { nombre: 'Fierro Corrugado 1/2" Aceros Arequipa', descripcion: 'Varilla de construcción', precioSugerido: 45.00, unidadConteo: 'NIU' },
    { nombre: 'Ladrillo King Kong 18 huecos', descripcion: 'Ladrillo para muros portantes', precioSugerido: 1.20, unidadConteo: 'NIU' },
    { nombre: 'Pintura Vencelatex Blanco', descripcion: 'Galón de pintura látex lavable', precioSugerido: 45.00, unidadConteo: 'GLN' },
    { nombre: 'Thinner Acrílico Vencedor', descripcion: 'Botella 1 litro', precioSugerido: 15.00, unidadConteo: 'NIU' },
    { nombre: 'Clavos 2" con cabeza', descripcion: 'Caja x 1kg', precioSugerido: 8.00, unidadConteo: 'KG' },
    { nombre: 'Martillo Truper 16oz', descripcion: 'Martillo uña curva mango madera', precioSugerido: 25.00, unidadConteo: 'NIU' },
    { nombre: 'Cinta Aislante 3M', descripcion: 'Rollo 20m negro', precioSugerido: 4.50, unidadConteo: 'NIU' },
];

export const catalogoFarmacia = [
    { nombre: 'Paracetamol 500mg', descripcion: 'Caja x 100 tabletas', precioSugerido: 15.00, unidadConteo: 'CJA' },
    { nombre: 'Ibuprofeno 400mg', descripcion: 'Caja x 10 tabletas', precioSugerido: 5.00, unidadConteo: 'CJA' },
    { nombre: 'Amoxicilina 500mg', descripcion: 'Generico, tira x 10', precioSugerido: 8.00, unidadConteo: 'NIU' },
    { nombre: 'Alcohol Medicinal 96° 1L', descripcion: 'Botella 1 litro', precioSugerido: 12.00, unidadConteo: 'NIU' },
    { nombre: 'Algodón Hidrófilo 100g', descripcion: 'Bolsa 100g', precioSugerido: 3.50, unidadConteo: 'NIU' },
    { nombre: 'Gasa Estéril 10x10', descripcion: 'Sobre individual', precioSugerido: 1.00, unidadConteo: 'NIU' },
    { nombre: 'Suero Rehidratante Electrolight', descripcion: 'Sabor Fresa 1L', precioSugerido: 6.50, unidadConteo: 'NIU' },
];

export async function seedCatalog(prisma: PrismaClient) {
    console.log('🌱 Seeding Global Catalog...');

    // 1. Get or Create Rubros
    const rubroBodega = await prisma.rubro.upsert({ where: { nombre: 'Bodega' }, update: {}, create: { nombre: 'Bodega' } });
    const rubroFerreteria = await prisma.rubro.upsert({ where: { nombre: 'Ferreteria' }, update: {}, create: { nombre: 'Ferreteria' } });
    const rubroFarmacia = await prisma.rubro.upsert({ where: { nombre: 'Farmacia' }, update: {}, create: { nombre: 'Farmacia' } });

    // 2. Seed Products for Bodega
    for (const prod of catalogoBodega) {
        await prisma.productoPlantilla.create({
            data: { ...prod, rubroId: rubroBodega.id }
        });
    }

    // 3. Seed Products for Ferreteria
    for (const prod of catalogoFerreteria) {
        await prisma.productoPlantilla.create({
            data: { ...prod, rubroId: rubroFerreteria.id }
        });
    }

    // 4. Seed Products for Farmacia
    for (const prod of catalogoFarmacia) {
        await prisma.productoPlantilla.create({
            data: { ...prod, rubroId: rubroFarmacia.id }
        });
    }

    console.log('✅ Global Catalog seeded successfully');
}
