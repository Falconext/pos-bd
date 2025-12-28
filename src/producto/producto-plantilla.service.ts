
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'; // Assuming PrismaService exists at common or global
import { CreateProductoDto } from './dto/create-producto.dto'; // Use if needed, or create specific DTO

import { S3Service } from '../s3/s3.service';
import { EstadoType } from '@prisma/client';

@Injectable()
export class ProductoPlantillaService {
    constructor(
        private prisma: PrismaService,
        private s3Service: S3Service
    ) { }

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

        const resultados: any[] = [];

        for (const plantilla of plantillas) {
            // Generar código único básico
            const codigoBase = plantilla.nombre.substring(0, 3).toUpperCase() + Math.floor(Math.random() * 1000);

            // 1. Manejo de Categoría
            let categoriaId: number | null = null;
            if (plantilla.categoria && plantilla.categoria.trim() !== '') {
                const nombreCat = plantilla.categoria.trim();
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
                        nombre: { equals: nombreMarca }
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
                    stock: 0,
                    unidadMedidaId: unidad?.id || 1,
                    categoriaId: categoriaId,
                    marcaId: marcaId, // Asignar marca
                    tipoAfectacionIGV: '10',
                    igvPorcentaje: 18.00,
                    estado: 'ACTIVO',
                    publicarEnTienda: true,
                },
            });
            resultados.push(nuevoProducto);
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
                { nombre: { contains: search } },
                { descripcion: { contains: search } },
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

            // Buscar imagen
            console.log(`[MagicGallery] Searching for: ${nombre}`);
            let results: any = {};
            try {
                results = await GOOGLE_IMG_SCRAP({
                    search: nombre,
                    limit: 5,
                    safeSearch: false
                });
            } catch (searchError: any) {
                console.warn(`[MagicGallery] Lib error for ${nombre}: ${searchError.message}`);
                return { success: false, message: 'Advertencia: Fallo interno al buscar imagen.' };
            }

            // Validar resultado
            if (results && results.result && Array.isArray(results.result) && results.result.length > 0) {
                // Tomar la primera imagen válida (preferir HTTPS)
                const image = results.result.find((img: any) => img.url && img.url.startsWith('http'));

                if (image && image.url) {
                    console.log(`[MagicGallery] Found URL: ${image.url}. Downloading...`);

                    try {
                        // 1. Descargar imagen (con timeout y user-agent real)
                        const response = await axios.get(image.url, {
                            responseType: 'arraybuffer',
                            timeout: 8000,
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                        });

                        if (response.status !== 200) throw new Error(`Status ${response.status}`);

                        const buffer = Buffer.from(response.data);
                        if (buffer.length < 1024) throw new Error('Image too small (<1KB)');

                        // 2. Subir a S3
                        // Generar key única limpia
                        const cleanName = nombre.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 50);
                        const key = `productos/plantillas/${id}-${cleanName}-${Date.now()}.webp`;

                        console.log(`[MagicGallery] Uploading to S3 key: ${key}`);
                        const s3Url = await this.s3Service.uploadImage(buffer, key);

                        // 3. Actualizar BD con URL de S3
                        const updated = await this.prisma.productoPlantilla.update({
                            where: { id },
                            data: { imagenUrl: s3Url }
                        });

                        return { success: true, url: s3Url, producto: updated };

                    } catch (downloadError: any) {
                        console.error(`[MagicGallery] Error downloading/uploading image: ${downloadError.message}`);
                        // Fallback: Si falla la descarga, guardar la URL externa (aunque sea hotlink)
                        // o retornar error. Decidimos retornar error para no ensuciar con links rotos.
                        return { success: false, message: 'Error al descargar/procesar la imagen remota' };
                    }
                }
            }

            return { success: false, message: 'No se encontraron imágenes válidas' };
        } catch (error: any) {
            console.error(`Error buscando imagen para ${nombre}:`, error);
            return { success: false, message: error.message };
        }
    }
}
