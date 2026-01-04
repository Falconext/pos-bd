import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('banners')
@UseGuards(JwtAuthGuard)
export class BannersController {
    constructor(private readonly bannersService: BannersService) { }

    @Post()
    create(@Req() req: any, @Body() createBannerDto: CreateBannerDto) {
        return this.bannersService.create(req.user.empresaId, createBannerDto);
    }

    @Post('upload')
    @UseInterceptors(FileInterceptor('file'))
    async uploadBanner(
        @Req() req: any,
        @UploadedFile() file: Express.Multer.File,
        @Body('titulo') titulo?: string,
        @Body('subtitulo') subtitulo?: string,
        @Body('linkUrl') linkUrl?: string,
        @Body('productoId') productoId?: string,
        @Body('orden') orden?: string,
    ) {
        if (!file) {
            throw new BadRequestException('No se proporcionó ningún archivo');
        }

        // Validate file type
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
        if (!allowedMimes.includes(file.mimetype)) {
            throw new BadRequestException('Tipo de archivo no permitido. Solo se permiten imágenes JPEG, PNG o WebP.');
        }

        // Validate file size (2.5MB max)
        if (file.size > 2.5 * 1024 * 1024) {
            throw new BadRequestException('El archivo es demasiado grande. Máximo 2.5MB.');
        }

        return this.bannersService.uploadBanner(
            req.user.empresaId,
            file,
            titulo || 'Banner',
            subtitulo,
            linkUrl,
            // productoId ? parseInt(productoId) : undefined,
            orden ? parseInt(orden) : undefined,
        );
    }

    @Get()
    findAll(@Req() req: any) {
        return this.bannersService.findAll(req.user.empresaId);
    }

    @Get(':id')
    findOne(@Req() req: any, @Param('id') id: string) {
        return this.bannersService.findOne(+id, req.user.empresaId);
    }

    @Patch(':id')
    update(@Req() req: any, @Param('id') id: string, @Body() updateBannerDto: UpdateBannerDto) {
        return this.bannersService.update(+id, req.user.empresaId, updateBannerDto);
    }

    @Delete(':id')
    remove(@Req() req: any, @Param('id') id: string) {
        return this.bannersService.remove(+id, req.user.empresaId);
    }
}
