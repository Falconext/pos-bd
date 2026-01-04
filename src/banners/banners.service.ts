import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { FeaturesService } from '../features/features.service';

@Injectable()
export class BannersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly featuresService: FeaturesService,
        private readonly s3Service: S3Service,
    ) { }

    async create(empresaId: number, createBannerDto: CreateBannerDto) {
        // Validar si tiene feature activado
        await this.featuresService.validarFeature(empresaId, 'tieneBanners');

        // Validar límite
        const bannersCount = await this.prisma.banner.count({
            where: { empresaId },
        });
        await this.featuresService.validarLimite(empresaId, 'banners', bannersCount);

        const { productoId, ...rest } = createBannerDto; // Exclude productoId
        return this.prisma.banner.create({
            data: {
                ...rest,
                empresaId,
            },
        });
    }

    async uploadBanner(
        empresaId: number,
        file: Express.Multer.File,
        titulo: string,
        subtitulo?: string,
        linkUrl?: string,
        productoId?: number,
        orden?: number,
    ) {
        // Validar si tiene feature activado
        await this.featuresService.validarFeature(empresaId, 'tieneBanners');

        // Validar límite
        const bannersCount = await this.prisma.banner.count({
            where: { empresaId },
        });
        await this.featuresService.validarLimite(empresaId, 'banners', bannersCount);

        // Upload to S3
        const timestamp = Date.now();
        const extension = file.originalname.split('.').pop() || 'webp';
        const key = `banners/empresa-${empresaId}/banner-${timestamp}.${extension}`;

        const imageUrl = await this.s3Service.uploadImage(file.buffer, key, file.mimetype);

        // Get next orden if not provided
        if (orden === undefined) {
            const maxOrden = await this.prisma.banner.findFirst({
                where: { empresaId },
                orderBy: { orden: 'desc' },
                select: { orden: true },
            });
            orden = (maxOrden?.orden ?? -1) + 1;
        }

        // Create banner record
        const banner = await this.prisma.banner.create({
            data: {
                empresaId,
                titulo,
                subtitulo,
                imagenUrl: imageUrl,
                linkUrl,
                // productoId, // Excluded due to schema mismatch
                orden,
                activo: true,
            },
        });

        // Return with signed URL if needed
        if (banner.imagenUrl && banner.imagenUrl.includes('amazonaws.com')) {
            const urlParts = banner.imagenUrl.split('amazonaws.com/');
            if (urlParts.length > 1) {
                const key = urlParts[1];
                try {
                    const signed = await this.s3Service.getSignedGetUrl(key);
                    console.log(`✅ Banner signed successfully: ${signed.substring(0, 50)}...`);
                    banner.imagenUrl = signed;
                } catch (e) {
                    console.error(`❌ Error signing banner URL in uploadBanner:`, e);
                }
            }
        }

        return banner;
    }

    async findAll(empresaId: number) {
        const banners = await this.prisma.banner.findMany({
            where: { empresaId },
            orderBy: { orden: 'asc' },
            select: {
                id: true,
                titulo: true,
                subtitulo: true,
                imagenUrl: true,
                linkUrl: true,
                orden: true,
                activo: true,
                creadoEn: true,
                empresaId: true,
                // productoId implicitly excluded
            }
        });

        // Enrich with signed URLs
        return Promise.all(banners.map(async (banner) => {
            if (banner.imagenUrl && banner.imagenUrl.includes('amazonaws.com')) {
                const urlParts = banner.imagenUrl.split('amazonaws.com/');
                if (urlParts.length > 1) {
                    const key = urlParts[1];
                    try {
                        const signed = await this.s3Service.getSignedGetUrl(key);
                        // console.log(`✅ Banner ${banner.id} signed: ${signed.substring(0, 30)}...`);
                        banner.imagenUrl = signed;
                    } catch (e) {
                        console.error(`❌ Error signing banner ${banner.id} in findAll:`, e);
                        // Keep original if signing fails
                    }
                }
            }
            return banner;
        }));
    }

    async findOne(id: number, empresaId: number) {
        const banner = await this.prisma.banner.findFirst({
            where: { id, empresaId },
        });
        if (!banner) throw new NotFoundException('Banner no encontrado');

        if (banner.imagenUrl && banner.imagenUrl.includes('amazonaws.com')) {
            const urlParts = banner.imagenUrl.split('amazonaws.com/');
            if (urlParts.length > 1) {
                const key = urlParts[1];
                try {
                    banner.imagenUrl = await this.s3Service.getSignedGetUrl(key);
                } catch (e) {
                    // Keep original
                }
            }
        }
        return banner;
    }

    async update(id: number, empresaId: number, updateBannerDto: UpdateBannerDto) {
        await this.findOne(id, empresaId); // Verificar propiedad
        return this.prisma.banner.update({
            where: { id },
            data: updateBannerDto,
        });
    }

    async remove(id: number, empresaId: number) {
        const banner = await this.findOne(id, empresaId); // Verificar propiedad

        // Optionally delete from S3
        if (banner.imagenUrl && banner.imagenUrl.includes('amazonaws.com')) {
            try {
                const urlParts = banner.imagenUrl.split('amazonaws.com/');
                if (urlParts.length > 1) {
                    const key = urlParts[1].split('?')[0]; // Remove query params
                    await this.s3Service.deleteFile(key);
                }
            } catch (error) {
                console.error('Error deleting banner from S3:', error);
                // Continue with database deletion even if S3 deletion fails
            }
        }

        return this.prisma.banner.delete({
            where: { id },
        });
    }
}
