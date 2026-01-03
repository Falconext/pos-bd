
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'; // Assuming PrismaService exists at common or global
import { CreateProductoDto } from './dto/create-producto.dto'; // Use if needed, or create specific DTO

import { S3Service } from '../s3/s3.service';
import { EstadoType } from '@prisma/client';
import { GeminiService } from '../gemini/gemini.service';

@Injectable()
export class ProductoPlantillaService {
    constructor(
        private prisma: PrismaService,
        private s3Service: S3Service,
        private geminiService: GeminiService
    ) { }

    async generarPropuestaIA(rubroId: number, query: string) {
        // 1. Obtener nombre del rubro
        const rubro = await this.prisma.rubro.findUnique({
            where: { id: rubroId }
        });
        if (!rubro) throw new NotFoundException('Rubro no encontrado');

        // 2. Generar productos con Gemini
        const productosGenerados = await this.geminiService.generarProductos(rubro.nombre, query);

        // 3. Asignar imágenes automáticamente en paralelo
        // Limitamos a 5 concurrentes para no saturar si son muchos
        const CONCURRENCY_LIMIT = 5;
        const productosConImagen: any[] = [];

        for (let i = 0; i < productosGenerados.length; i += CONCURRENCY_LIMIT) {
            const chunk = productosGenerados.slice(i, i + CONCURRENCY_LIMIT);
            const chunkResults = await Promise.all(chunk.map(async (prod: any) => {
                try {
                    // Buscar imagen referencial (URL directa de google o placeholder)
                    // No persistimos en S3 aun para que sea rapido, usamos la URL original si es http
                    // O si queremos calidad, podemos intentar obtener una URL valida.
                    const imageUrl = await this.buscarImagenWeb(prod.nombre);
                    return { ...prod, imagenUrl: imageUrl };
                } catch (e) {
                    return prod;
                }
            }));
            productosConImagen.push(...chunkResults);
        }

        return productosConImagen;
    }

    // Helper rapido para buscar imagen sin guardar en S3 (solo URL externa)
    async buscarImagenWeb(nombre: string): Promise<string | null> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { GOOGLE_IMG_SCRAP } = require('google-img-scrap');

            const results = await GOOGLE_IMG_SCRAP({
                search: `${nombre} product`,
                limit: 5,
                safeSearch: false
            });

            if (results && results.result && results.result.length > 0) {
                // Preferir HTTPS
                const valid = results.result.find((img: any) => img.url && img.url.startsWith('https'));
                return valid ? valid.url : results.result[0].url;
            }
            return null;
        } catch (error) {
            console.warn(`Error buscando imagen web para ${nombre}`, error);
            return null;
        }
    }

    async importarDesdeData(empresaId: number, productos: any[]) {
        const empresa = await this.prisma.empresa.findUnique({
            where: { id: empresaId },
        });
        if (!empresa) throw new NotFoundException('Empresa no encontrada');

        const resultados: any[] = [];
        let importedCount = 0;

        // Obtener último secuencial PR para Data
        let startSequence = 1;
        const allPrProducts = await this.prisma.producto.findMany({
            where: { empresaId, codigo: { startsWith: 'PR' } },
            select: { codigo: true }
        });

        if (allPrProducts.length > 0) {
            const pattern = /^PR(\d+)$/;
            let max = 0;
            for (const p of allPrProducts) {
                const match = p.codigo.match(pattern);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > max) max = num;
                }
            }
            startSequence = max + 1;
        }
        let indexInBatch = 0;

        for (const prod of productos) {
            // Generar código único básico si no viene
            let codigoBase = prod.codigo;
            if (!codigoBase && startSequence > 0) {
                codigoBase = `PR${(startSequence + indexInBatch).toString().padStart(3, '0')}`;
                indexInBatch++;
            } else if (!codigoBase) {
                codigoBase = (prod.nombre.substring(0, 3).toUpperCase() + Math.floor(Math.random() * 1000));
            }

            // 1. Manejo de Categoría
            let categoriaId: number | null = null;
            if (prod.categoria && prod.categoria.trim() !== '') {
                const nombreCat = prod.categoria.trim();
                const catExistente = await this.prisma.categoria.findFirst({
                    where: {
                        empresaId: empresaId,
                        nombre: { equals: nombreCat }
                    }
                });

                if (catExistente) {
                    categoriaId = catExistente.id;
                } else {
                    const nuevaCat = await this.prisma.categoria.create({
                        data: { empresaId, nombre: nombreCat }
                    });
                    categoriaId = nuevaCat.id;
                }
            }

            // 2. Manejo de Marca
            let marcaId: number | null = null;
            if (prod.marca && prod.marca.trim() !== '') {
                const nombreMarca = prod.marca.trim();
                const marcaExistente = await this.prisma.marca.findFirst({
                    where: {
                        empresaId: empresaId,
                        nombre: { equals: nombreMarca }
                    }
                });

                if (marcaExistente) {
                    marcaId = marcaExistente.id;
                } else {
                    const nuevaMarca = await this.prisma.marca.create({
                        data: { empresaId, nombre: nombreMarca }
                    });
                    marcaId = nuevaMarca.id;
                }
            }

            // Mapear unidad
            const unidad = await this.prisma.unidadMedida.findFirst({ where: { codigo: prod.unidadConteo } })
                || await this.prisma.unidadMedida.findFirst();

            try {
                // Verificar si código ya existe en empresa para no duplicar
                const exists = await this.prisma.producto.findFirst({
                    where: { empresaId, codigo: codigoBase }
                });

                if (!exists) {
                    const nuevoProducto = await this.prisma.producto.create({
                        data: {
                            empresaId,
                            codigo: codigoBase,
                            // Ojo: Schema tiene 'descripcion' como nombre comercial y 'descripcionLarga' como detalle
                            // prod.nombre -> descripcion (campo principal visual)
                            // prod.descripcion -> descripcionLarga
                            descripcion: prod.nombre,
                            descripcionLarga: prod.descripcion,
                            imagenUrl: prod.imagenUrl || 'https://via.placeholder.com/150', // Placeholder si no hay imagen
                            precioUnitario: Number(prod.precioSugerido) || 0,
                            valorUnitario: (Number(prod.precioSugerido) || 0) / 1.18,
                            stock: 50, // Stock inicial por defecto
                            stockMinimo: 5,
                            unidadMedidaId: unidad?.id || 1,
                            categoriaId: categoriaId,
                            marcaId: marcaId,
                            tipoAfectacionIGV: '10',
                            igvPorcentaje: 18.00,
                            estado: 'ACTIVO',
                            publicarEnTienda: true,
                        },
                    });
                    resultados.push(nuevoProducto);
                    importedCount++;
                }
            } catch (e) {
                console.error('Error importando producto IA', e);
            }
        }

        return {
            message: 'Importación IA completada',
            imported: importedCount,
            total: productos.length
        };
    }

    async subirImagen(id: number, file: { buffer: Buffer, mimetype: string }) {
        const plantilla = await this.prisma.productoPlantilla.findUnique({ where: { id } });
        if (!plantilla) throw new NotFoundException('Plantilla no encontrada');

        const key = `productos/empresa-0/producto-${id}/principal-${Date.now()}.webp`;
        const url = await this.s3Service.uploadImage(file.buffer, key);

        return this.prisma.productoPlantilla.update({
            where: { id },
            data: { imagenUrl: url },
        });
    }

    async findAllByRubro(rubroId: number) {
        return this.prisma.productoPlantilla.findMany({
            where: { rubroId },
            orderBy: { nombre: 'asc' },
        });
    }

    async importarPlantillas(empresaId: number, plantillasIds: number[]) {
        const empresa = await this.prisma.empresa.findUnique({
            where: { id: empresaId },
        });

        if (!empresa) throw new NotFoundException('Empresa no encontrada');

        const plantillas = await this.prisma.productoPlantilla.findMany({
            where: { id: { in: plantillasIds } },
        });

        // Optimización: Cargar nombres de productos existentes para evitar duplicados por nombre
        const productosExistentes = await this.prisma.producto.findMany({
            where: {
                empresaId,
                estado: { not: EstadoType.PLACEHOLDER } // Ignorar productos eliminados, permitir re-importar
            },
            select: { descripcion: true }
        });

        // Set para búsqueda rápida O(1) - Normalizado a mayúsculas/trim
        const nombresExistentes = new Set(
            productosExistentes.map(p => p.descripcion.trim().toUpperCase())
        );

        const resultados: any[] = [];
        const errors: any[] = [];

        // Obtener último secuencial PR
        let startSequence = 1;
        const lastProd = await this.prisma.producto.findFirst({
            where: {
                empresaId,
                codigo: { startsWith: 'PR' }
            },
            orderBy: { id: 'desc' }, // Aproximación, idealmente parsear código
            take: 100 // Traer un lote para parsear el máximo real
        });

        // Buscar el máximo real parseando
        const allPrProducts = await this.prisma.producto.findMany({
            where: { empresaId, codigo: { startsWith: 'PR' } },
            select: { codigo: true }
        });

        if (allPrProducts.length > 0) {
            const pattern = /^PR(\d+)$/;
            let max = 0;
            for (const p of allPrProducts) {
                const match = p.codigo.match(pattern);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > max) max = num;
                }
            }
            startSequence = max + 1;
        }

        let indexInBatch = 0;

        for (const plantilla of plantillas) {
            try {
                // Validación Anti-Duplicados por Nombre
                const nombreNormalizado = plantilla.nombre.trim().toUpperCase();
                if (nombresExistentes.has(nombreNormalizado)) {
                    // console.log(`Skipping duplicate: ${plantilla.nombre}`);
                    continue;
                }

                // Generar código secuencial PR
                const nextId = startSequence + indexInBatch;
                const codigoBase = `PR${nextId.toString().padStart(3, '0')}`;
                indexInBatch++;

                // 1. Manejo de Categoría
                let categoriaId: number | null = null;
                if (plantilla.categoria && plantilla.categoria.trim() !== '') {
                    const nombreCat = plantilla.categoria.trim();
                    const catExistente = await this.prisma.categoria.findFirst({
                        where: {
                            empresaId: empresaId,
                            nombre: { equals: nombreCat, mode: 'insensitive' }
                        }
                    });

                    if (catExistente) {
                        categoriaId = catExistente.id;
                    } else {
                        const nuevaCat = await this.prisma.categoria.create({
                            data: {
                                empresaId: empresaId,
                                nombre: nombreCat
                            }
                        });
                        categoriaId = nuevaCat.id;
                    }
                }

                // 2. Manejo de Marca
                let marcaId: number | null = null;
                if (plantilla.marca && plantilla.marca.trim() !== '') {
                    const nombreMarca = plantilla.marca.trim();
                    const marcaExistente = await this.prisma.marca.findFirst({
                        where: {
                            empresaId: empresaId,
                            nombre: { equals: nombreMarca, mode: 'insensitive' }
                        }
                    });

                    if (marcaExistente) {
                        marcaId = marcaExistente.id;
                    } else {
                        const nuevaMarca = await this.prisma.marca.create({
                            data: {
                                empresaId: empresaId,
                                nombre: nombreMarca
                            }
                        });
                        marcaId = nuevaMarca.id;
                    }
                }

                // Mapear plantilla a producto
                const unidad = await this.prisma.unidadMedida.findFirst({ where: { codigo: plantilla.unidadConteo } })
                    || await this.prisma.unidadMedida.findFirst();

                const nuevoProducto = await this.prisma.producto.create({
                    data: {
                        empresaId,
                        codigo: codigoBase,
                        descripcion: plantilla.nombre,
                        descripcionLarga: plantilla.descripcion,
                        imagenUrl: plantilla.imagenUrl,
                        precioUnitario: plantilla.precioSugerido || 0,
                        valorUnitario: (Number(plantilla.precioSugerido) || 0) / 1.18,
                        stock: 50,
                        stockMinimo: 5,
                        unidadMedidaId: unidad?.id || 1,
                        categoriaId: categoriaId,
                        marcaId: marcaId, // Asignar marca
                        tipoAfectacionIGV: '10',
                        igvPorcentaje: 18.00,
                        estado: 'ACTIVO',
                        publicarEnTienda: true,
                    },
                });
                // Marcar como existente para evitar duplicados en el mismo lote
                nombresExistentes.add(nombreNormalizado);
                resultados.push(nuevoProducto);
            } catch (error: any) {
                console.warn(`Error importando plantilla ID ${plantilla.id}:`, error.message);
                errors.push({ id: plantilla.id, error: error.message });
            }
        }

        return resultados;
    }

    async importarTodo(empresaId: number) {
        // 1. Obtener rubro de la empresa
        const empresa = await this.prisma.empresa.findUnique({
            where: { id: empresaId },
            include: { rubro: true }
        });

        if (!empresa || !empresa.rubroId) throw new NotFoundException('Empresa no encontrada o sin rubro asignado');

        // 2. Obtener todas las plantillas del rubro
        const plantillas = await this.prisma.productoPlantilla.findMany({
            where: { rubroId: empresa.rubroId }
        });

        if (plantillas.length === 0) return { message: 'No hay plantillas disponibles para este rubro', imported: 0, updated: 0 };

        // 3. Obtener productos existentes en la empresa (con código, imagen y categoría)
        const productosExistentes = await this.prisma.producto.findMany({
            where: { empresaId },
            select: { id: true, codigo: true, imagenUrl: true, categoriaId: true, marcaId: true }
        });

        const productosPorCodigo = new Map(
            productosExistentes.filter(p => p.codigo).map(p => [p.codigo, p])
        );

        // 4. Separar plantillas en: nuevas vs existentes que necesitan imagen/categoria
        const plantillasNuevas: typeof plantillas = [];
        const plantillasParaActualizar: { plantilla: typeof plantillas[0], productoId: number, updateFields: any }[] = [];

        for (const plantilla of plantillas) {
            if (!plantilla.codigo) {
                // Sin código, se considera nueva
                plantillasNuevas.push(plantilla);
            } else {
                const productoExistente = productosPorCodigo.get(plantilla.codigo);
                if (!productoExistente) {
                    // No existe en la empresa, importar como nuevo
                    plantillasNuevas.push(plantilla);
                } else {
                    // Verificar qué campos necesitan actualización
                    const updateFields: any = {};

                    const productoExistente = productosPorCodigo.get(plantilla.codigo);

                    // Si no tiene imagen y la plantilla sí tiene
                    if (productoExistente && !productoExistente.imagenUrl && plantilla.imagenUrl) {
                        updateFields.imagenUrl = plantilla.imagenUrl;
                    }

                    // Si no tiene categoría y la plantilla sí tiene
                    if (productoExistente && !productoExistente.categoriaId && plantilla.categoria) {
                        const nombreCat = plantilla.categoria.trim();
                        const catExistente = await this.prisma.categoria.findFirst({
                            where: {
                                empresaId: empresaId,
                                nombre: { equals: nombreCat }
                            }
                        });

                        if (catExistente) {
                            updateFields.categoriaId = catExistente.id;
                        } else {
                            const nuevaCat = await this.prisma.categoria.create({
                                data: { empresaId, nombre: nombreCat }
                            });
                            updateFields.categoriaId = nuevaCat.id;
                        }
                    }

                    if (productoExistente && !productoExistente.marcaId && plantilla.marca) {
                        const nombreMarca = plantilla.marca.trim();
                        const marcaExistente = await this.prisma.marca.findFirst({
                            where: {
                                empresaId: empresaId,
                                nombre: { equals: nombreMarca }
                            }
                        });

                        if (marcaExistente) {
                            updateFields.marcaId = marcaExistente.id;
                        } else {
                            const nuevaMarca = await this.prisma.marca.create({
                                data: { empresaId, nombre: nombreMarca }
                            });
                            updateFields.marcaId = nuevaMarca.id;
                        }
                    }

                    if (Object.keys(updateFields).length > 0) {
                        plantillasParaActualizar.push({ plantilla, productoId: productoExistente!.id, updateFields });
                    }
                }
            }
        }

        // 5. Importar nuevos productos
        let importados = 0;
        if (plantillasNuevas.length > 0) {
            const ids = plantillasNuevas.map(p => p.id);
            const resultados = await this.importarPlantillas(empresaId, ids);
            importados = resultados.length;
        }

        // 6. Actualizar productos existentes (imagen y/o categoría)
        let actualizados = 0;
        for (const { productoId, updateFields } of plantillasParaActualizar) {
            try {
                await this.prisma.producto.update({
                    where: { id: productoId },
                    data: updateFields
                });
                actualizados++;
            } catch (e) {
                console.error(`Error actualizando producto ${productoId}:`, e);
            }
        }

        return {
            message: 'Importación masiva completada',
            imported: importados,
            updated: actualizados,
            totalCatalogo: plantillas.length,
            omitidos: plantillas.length - plantillasNuevas.length - plantillasParaActualizar.length
        };
    }

    async findAll(params: { search?: string; rubroId?: number; limit?: number; page?: number }) {
        const { search, rubroId, limit = 50, page = 1 } = params;
        const skip = (page - 1) * limit;

        const where: any = {};
        if (rubroId) where.rubroId = rubroId;
        if (search) {
            where.OR = [
                { nombre: { contains: search, mode: 'insensitive' } },
                { descripcion: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [dataRaw, total] = await Promise.all([
            this.prisma.productoPlantilla.findMany({
                where,
                skip,
                take: limit,
                orderBy: { nombre: 'asc' },
                include: { rubro: true }
            }),
            this.prisma.productoPlantilla.count({ where }),
        ]);

        // Helper para firmar URLs de S3
        const signIfS3 = async (url?: string | null) => {
            try {
                if (!url) return url;
                const idx = url.indexOf('amazonaws.com/');
                if (idx === -1) return url;
                const key = url.substring(idx + 'amazonaws.com/'.length);
                if (!key) return url;
                // Usamos el metodo getSignedGetUrl del servicio S3 (asegurar que es publico o accesible)
                // Si s3Service no tiene getSignedGetUrl expuesto, habra que revisar S3Service.
                // En ProductoService se usa this.s3.getSignedGetUrl. Aqui es this.s3Service.
                return await this.s3Service.getSignedGetUrl(key, 3600) || url;
            } catch (e) {
                return url;
            }
        };

        const data = await Promise.all(dataRaw.map(async (p) => ({
            ...p,
            imagenUrl: await signIfS3(p.imagenUrl)
        })));

        return { data, total, page, limit };
    }

    /**
     * Obtiene productos para categorizar con IA
     * @param rubroId Filtrar por rubro (opcional)
     * @param soloSinCategoria Si es true, solo devuelve productos sin categoría o con "OTROS"
     */
    async obtenerParaCategorizar(rubroId?: number, soloSinCategoria = true) {
        const where: any = {};

        if (rubroId) {
            where.rubroId = rubroId;
        }

        if (soloSinCategoria) {
            where.OR = [
                { categoria: null },
                { categoria: '' },
                { categoria: 'OTROS' },
                { categoria: { equals: null } }
            ];
        }

        return this.prisma.productoPlantilla.findMany({
            where,
            select: {
                id: true,
                nombre: true,
                categoria: true
            },
            orderBy: { nombre: 'asc' }
        });
    }

    async create(data: any) {
        return this.prisma.productoPlantilla.create({
            data: {
                nombre: data.nombre,
                descripcion: data.descripcion,
                imagenUrl: data.imagenUrl,
                precioSugerido: data.precioSugerido,
                rubroId: data.rubroId,
                categoria: data.categoria,
                unidadConteo: data.unidadConteo || 'NIU',
                codigo: data.codigo,
                marca: data.marca
            },
        });
    }

    async update(id: number, data: any) {
        return this.prisma.productoPlantilla.update({
            where: { id },
            data: {
                nombre: data.nombre,
                descripcion: data.descripcion,
                imagenUrl: data.imagenUrl,
                precioSugerido: data.precioSugerido,
                rubroId: data.rubroId,
                categoria: data.categoria,
                unidadConteo: data.unidadConteo,
                codigo: data.codigo,
                marca: data.marca
            },
        });
    }

    async remove(id: number) {
        return this.prisma.productoPlantilla.delete({
            where: { id },
        });
    }

    async deleteMany(ids: number[]) {
        return this.prisma.productoPlantilla.deleteMany({
            where: { id: { in: ids } }
        });
    }

    async deleteImagesMany(ids: number[]) {
        // En un escenario real, también deberíamos borrar los objetos de S3
        // Por ahora, solo limpiamos la referencia en BD
        return this.prisma.productoPlantilla.updateMany({
            where: { id: { in: ids } },
            data: { imagenUrl: null }
        });
    }

    async importarDeEmpresa(empresaId: number, rubroId: number) {
        console.log(`importarDeEmpresa called with: empresaId=${empresaId}, rubroId=${rubroId}`);
        console.log(`EstadoType:`, EstadoType);

        try {
            // Fix: Reset ID sequence to avoid "Unique constraint failed on the fields: (`id`)"
            // This happens if rows were inserted manually or via seed without updating the sequence
            try {
                await this.prisma.$executeRawUnsafe(`
                    SELECT setval(pg_get_serial_sequence('producto_plantillas', 'id'), (SELECT COALESCE(MAX(id), 0) + 1 FROM producto_plantillas), false);
                `);
            } catch (seqError) {
                console.warn('Could not reset sequence (might not be Postgres or permissions issue):', seqError);
            }

            // Using string literal 'ACTIVO' to avoid potential Enum import issues
            const productos = await this.prisma.producto.findMany({
                where: {
                    empresaId: Number(empresaId),
                    estado: 'ACTIVO'
                },
                include: { categoria: true }
            });
            console.log(`Found ${productos.length} products`);


            let count = 0;
            const errors: any[] = [];

            for (const p of productos) {
                try {
                    // Validate unique codigo if sending, else fallback to name
                    if (!p.codigo) continue;

                    const data = {
                        nombre: p.descripcion,
                        descripcion: p.descripcionLarga || p.descripcion,
                        imagenUrl: p.imagenUrl,
                        precioSugerido: p.precioUnitario,
                        rubroId: rubroId,
                        categoria: p.categoria?.nombre || null,
                        unidadConteo: 'NIU', // default
                        codigo: p.codigo
                    };

                    // Intenta buscar por código
                    const existing = await this.prisma.productoPlantilla.findFirst({
                        where: { codigo: p.codigo }
                    });

                    if (existing) {
                        const updateData: any = {};
                        if (!existing.imagenUrl && p.imagenUrl) updateData.imagenUrl = p.imagenUrl;
                        if (!existing.descripcion && p.descripcionLarga) updateData.descripcion = p.descripcionLarga;

                        if (Object.keys(updateData).length > 0) {
                            await this.prisma.productoPlantilla.update({
                                where: { id: existing.id },
                                data: updateData
                            });
                        }
                    } else {
                        // Create new
                        await this.prisma.productoPlantilla.create({
                            data
                        });
                        count++;
                    }
                } catch (error: any) {
                    console.error(`Error importing product ${p.codigo}:`, error);
                    errors.push({ codigo: p.codigo, error: error.message });
                }
            }

            if (errors.length > 0) {
                console.warn('Import completed with errors:', errors);
            }

            return {
                message: errors.length > 0 ? 'Importación con errores' : 'Importación completada',
                importados: count,
                totalEscaneados: productos.length,
                errores: errors.length,
                detallesErrores: errors.slice(0, 10)
            };
        } catch (error: any) {
            console.error('CRITICAL ERROR in importarDeEmpresa:', error);
            // Return error details instead of throwing 500
            return {
                success: false,
                message: 'Error crítico al importar productos',
                error: error.message,
                stack: error.stack
            };
        }
    }

    async autoAsignarImagen(id: number, nombre: string) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { GOOGLE_IMG_SCRAP } = require('google-img-scrap');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const axios = require('axios');

            // Buscar imagen (priorizar PNG y fondo transparente)
            const searchQuery = `${nombre} product`;
            console.log(`[MagicGallery] Searching for: ${searchQuery}`);
            let results: any = {};
            try {
                results = await GOOGLE_IMG_SCRAP({
                    search: searchQuery,
                    limit: 8,
                    safeSearch: false
                });
            } catch (searchError: any) {
                console.warn(`[MagicGallery] Lib error for ${nombre}: ${searchError.message}`);
                return { success: false, message: 'Advertencia: Fallo interno al buscar imagen.' };
            }

            // Validar resultado
            if (results && results.result && Array.isArray(results.result) && results.result.length > 0) {
                // Filtrar solo las que tengan URL http/https
                const candidates = results.result.filter((img: any) => img.url && img.url.startsWith('http'));

                if (candidates.length === 0) {
                    return { success: false, message: 'No se encontraron candidatas válidas (http/s).' };
                }

                // Iterar sobre candidatos hasta tener éxito
                for (let i = 0; i < Math.min(candidates.length, 5); i++) {
                    const image = candidates[i];
                    console.log(`[MagicGallery] [${i + 1}/${Math.min(candidates.length, 5)}] Trying URL: ${image.url}`);

                    try {
                        const response = await axios.get(image.url, {
                            responseType: 'arraybuffer',
                            timeout: 5000,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                            }
                        });

                        if (response.status !== 200) throw new Error(`Status ${response.status}`);

                        const buffer = Buffer.from(response.data);
                        if (buffer.length < 1024) throw new Error('Image too small (<1KB)');

                        let processedBuffer = buffer;
                        try {
                            // @ts-ignore
                            const sharp = (await import('sharp')).default as any;
                            processedBuffer = await sharp(buffer)
                                .resize(500, 500, {
                                    fit: 'contain',
                                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                                })
                                .webp({ quality: 85 })
                                .toBuffer();
                        } catch (sharpError) {
                            console.warn(`[MagicGallery] Sharp err: ${sharpError}`);
                        }

                        const cleanName = nombre.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 50);
                        const key = `productos/plantillas/${id}-${cleanName}-${Date.now()}.webp`;

                        console.log(`[MagicGallery] Success! Uploading to S3: ${key}`);
                        const s3Url = await this.s3Service.uploadImage(processedBuffer, key);

                        // Firmar la URL inmediatamente para que el frontend pueda renderizarla
                        const signedUrl = await this.s3Service.getSignedGetUrl(key, 3600);

                        const updated = await this.prisma.productoPlantilla.update({
                            where: { id },
                            data: { imagenUrl: s3Url }
                        });

                        return { success: true, url: signedUrl || s3Url, producto: updated };

                    } catch (err: any) {
                        console.warn(`[MagicGallery] Candidate ${i + 1} failed: ${err.message}`);
                    }
                }

                return { success: false, message: 'No se pudo descargar ninguna imagen válida tras varios intentos.' };
            }

            return { success: false, message: 'No se encontraron imágenes válidas' };
        } catch (error: any) {
            console.error(`Error buscando imagen para ${nombre}:`, error);
            return { success: false, message: error.message };
        }
    }
}
