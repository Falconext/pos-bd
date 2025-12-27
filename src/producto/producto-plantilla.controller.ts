
import { Controller, Get, Post, Body, Param, UseGuards, Request, UseInterceptors, UploadedFile, ParseIntPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageUploadOptions } from '../common/utils/multer.config';
import { ProductoPlantillaService } from './producto-plantilla.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { GeminiService } from '../gemini/gemini.service';

@Controller('plantillas')
export class ProductoPlantillaController {
    constructor(
        private readonly plantillaService: ProductoPlantillaService,
        private readonly geminiService: GeminiService
    ) { }

    @Post(':id/imagen')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(FileInterceptor('file', imageUploadOptions))
    async subirImagen(
        @Param('id', ParseIntPipe) id: number,
        @UploadedFile() file: Express.Multer.File
    ) {
        return this.plantillaService.subirImagen(id, { buffer: file.buffer, mimetype: file.mimetype });
    }

    @Get('rubro/:rubroId')
    @UseGuards(JwtAuthGuard)
    async getByRubro(@Param('rubroId') rubroId: string) {
        return this.plantillaService.findAllByRubro(Number(rubroId));
    }


    @Get()
    // @UseGuards(JwtAuthGuard) // Permitir acceso autenticado para listar
    async findAll(@Request() req) {
        const { search, rubroId, limit, page } = req.query;
        return this.plantillaService.findAll({
            search,
            rubroId: rubroId ? Number(rubroId) : undefined,
            limit: limit ? Number(limit) : undefined,
            page: page ? Number(page) : undefined
        });
    }

    @Post()
    @UseGuards(JwtAuthGuard)
    async create(@Body() body: any) {
        return this.plantillaService.create(body);
    }

    @Post('importar')
    @UseGuards(JwtAuthGuard)
    async importar(@Request() req, @Body() body: { plantillasIds: number[] }) {
        // Assuming user has empresaId in the JWT payload (req.user)
        const empresaId = req.user?.empresaId || req.user?.empresa?.id;
        return this.plantillaService.importarPlantillas(Number(empresaId), body.plantillasIds);
    }

    @Post('importar-de-empresa')
    @UseGuards(JwtAuthGuard)
    async importarDeEmpresa(@Body() body: { empresaId: number, rubroId: number }) {
        return this.plantillaService.importarDeEmpresa(Number(body.empresaId), Number(body.rubroId));
    }

    @Post('importar-todo')
    @UseGuards(JwtAuthGuard)
    async importarTodo(@Request() req) {
        const empresaId = req.user?.empresaId || req.user?.empresa?.id;
        return this.plantillaService.importarTodo(Number(empresaId));
    }

    /**
     * Endpoint para categorizar productos automáticamente con IA
     * Procesa productos sin categoría y les asigna una usando Gemini
     * También detecta y guarda la marca si está presente en el nombre
     */
    @Post('categorizar-ia')
    @UseGuards(JwtAuthGuard)
    async categorizarConIA(@Body() body: { rubroId?: number; soloSinCategoria?: boolean }) {
        if (!this.geminiService.isEnabled()) {
            return { success: false, message: 'Gemini AI no está configurado. Agrega GEMINI_API_KEY al .env' };
        }

        // Obtener productos a categorizar
        const productos = await this.plantillaService.obtenerParaCategorizar(body.rubroId, body.soloSinCategoria ?? true);

        if (productos.length === 0) {
            return { success: true, message: 'No hay productos por categorizar', procesados: 0 };
        }

        // Llamar a Gemini para categorizar y detectar marcas
        const categorizados = await this.geminiService.categorizarProductos(
            productos.map(p => ({ id: p.id, nombre: p.nombre }))
        );

        // Actualizar en la base de datos (categoría y marca)
        let actualizados = 0;
        let marcasDetectadas = 0;
        for (const item of categorizados) {
            try {
                const updateData: any = { categoria: item.categoria };
                // Solo agregar marca si fue detectada
                if (item.marca) {
                    updateData.marca = item.marca;
                    marcasDetectadas++;
                }

                // Agregar descripción si la IA generó una válida
                if (item.descripcion) {
                    updateData.descripcion = item.descripcion;
                }

                await this.plantillaService.update(item.id, updateData);
                actualizados++;
            } catch (e) {
                console.error(`Error actualizando producto ${item.id}:`, e);
            }
        }

        return {
            success: true,
            message: `Categorización completada`,
            total: productos.length,
            procesados: actualizados,
            marcasDetectadas,
            categorias: [...new Set(categorizados.map(c => c.categoria))],
            marcas: [...new Set(categorizados.filter(c => c.marca).map(c => c.marca))]
        };
    }

    @Post('search-image')
    @UseGuards(JwtAuthGuard)
    async searchImage(@Body() body: { id: number; nombre: string }) {
        return this.plantillaService.autoAsignarImagen(Number(body.id), body.nombre);
    }

    // IMPORTANT: Static routes MUST come before dynamic :id routes
    @Post('masivo/delete')
    @UseGuards(JwtAuthGuard)
    async deleteMany(@Body() body: { ids: number[] }) {
        return this.plantillaService.deleteMany(body.ids);
    }

    @Post('masivo/delete-images')
    @UseGuards(JwtAuthGuard)
    async deleteImagesMany(@Body() body: { ids: number[] }) {
        return this.plantillaService.deleteImagesMany(body.ids);
    }

    // Dynamic :id routes AFTER static routes
    @UseGuards(JwtAuthGuard)
    @Post(':id') // Usando POST con ID para update si PUT da problemas, o standard PUT
    async update(@Param('id') id: string, @Body() body: any) {
        return this.plantillaService.update(Number(id), body);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/delete') // Usando POST para delete si DELETE da problemas
    async remove(@Param('id') id: string) {
        return this.plantillaService.remove(Number(id));
    }
}
