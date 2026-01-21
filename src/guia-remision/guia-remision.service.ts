import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGuiaRemisionDto } from './dto/create-guia-remision.dto';
import { UpdateGuiaRemisionDto } from './dto/update-guia-remision.dto';
import { QueryGuiaRemisionDto } from './dto/query-guia-remision.dto';
import { SunatGuiaService } from './sunat-guia.service';

@Injectable()
export class GuiaRemisionService {
    constructor(
        private prisma: PrismaService,
        private sunatGuiaService: SunatGuiaService,
    ) { }

    async create(createDto: CreateGuiaRemisionDto, empresaId: number, usuarioId?: number) {
        // Generar correlativo automático si no se proporciona
        if (!createDto.correlativo) {
            const ultimaGuia = await this.prisma.guiaRemision.findFirst({
                where: {
                    empresaId,
                    serie: createDto.serie,
                },
                orderBy: {
                    correlativo: 'desc',
                },
            });
            createDto.correlativo = ultimaGuia ? ultimaGuia.correlativo + 1 : 1;
        }

        // Validar que el correlativo no exista
        const existeGuia = await this.prisma.guiaRemision.findFirst({
            where: {
                empresaId,
                serie: createDto.serie,
                correlativo: createDto.correlativo,
            },
        });

        if (existeGuia) {
            throw new BadRequestException(
                `Ya existe una guía con serie ${createDto.serie} y correlativo ${createDto.correlativo}`,
            );
        }

        // Validaciones de negocio
        this.validateModoTransporte(createDto);

        // Extraer detalles para crear por separado
        const { detalles, ...guiaData } = createDto;

        // Asegurar que correlativo esté definido
        const correlativoFinal = createDto.correlativo!;

        // Crear guía de remisión
        // Crear guía de remisión con reintento por si hay colisión de correlativo
        try {
            const guia = await this.prisma.guiaRemision.create({
                data: {
                    ...guiaData,
                    correlativo: correlativoFinal,
                    empresaId,
                    usuarioId,
                    fechaEmision: new Date(guiaData.fechaEmision),
                    fechaInicioTraslado: new Date(guiaData.fechaInicioTraslado),
                    horaEmision: guiaData.horaEmision || this.getCurrentTime(),
                    detalles: {
                        create: detalles.map((detalle, index) => ({
                            numeroOrden: index + 1,
                            codigoProducto: detalle.codigoProducto,
                            descripcion: detalle.descripcion,
                            cantidad: detalle.cantidad,
                            unidadMedida: detalle.unidadMedida || 'NIU',
                            productoId: detalle.productoId,
                        })),
                    },
                },
                include: {
                    detalles: {
                        include: {
                            producto: true,
                        },
                    },
                    empresa: true,
                    cliente: true,
                },
            });
            return guia;
        } catch (error) {
            if (error.code === 'P2002') {
                // Si falla por duplicado, intentamos una vez más con el siguiente correlativo
                const nuevoCorrelativo = correlativoFinal + 1;
                // Verificamos si podemos usar el siguiente
                const guia = await this.prisma.guiaRemision.create({
                    data: {
                        ...guiaData,
                        correlativo: nuevoCorrelativo,
                        empresaId,
                        usuarioId,
                        fechaEmision: new Date(guiaData.fechaEmision),
                        fechaInicioTraslado: new Date(guiaData.fechaInicioTraslado),
                        horaEmision: guiaData.horaEmision || this.getCurrentTime(),
                        detalles: {
                            create: detalles.map((detalle, index) => ({
                                numeroOrden: index + 1,
                                codigoProducto: detalle.codigoProducto,
                                descripcion: detalle.descripcion,
                                cantidad: detalle.cantidad,
                                unidadMedida: detalle.unidadMedida || 'NIU',
                                productoId: detalle.productoId,
                            })),
                        },
                    },
                    include: {
                        detalles: {
                            include: {
                                producto: true,
                            },
                        },
                        empresa: true,
                        cliente: true,
                    },
                });
                return guia;
            }
            throw error;
        }
    }

    async findAll(query: QueryGuiaRemisionDto, empresaId: number) {
        const { page = 1, limit = 10, ...filters } = query;
        const skip = (page - 1) * limit;

        const where: any = { empresaId };

        if (filters.serie) {
            where.serie = filters.serie;
        }

        if (filters.estadoSunat) {
            where.estadoSunat = filters.estadoSunat;
        }

        if (filters.destinatario) {
            where.OR = [
                { destinatarioRazonSocial: { contains: filters.destinatario, mode: 'insensitive' } },
                { destinatarioNumDoc: { contains: filters.destinatario } },
            ];
        }

        if (filters.search) {
            const search = filters.search.trim();

            // Check if it matches "Serie-Correlativo" format (e.g., T001-123)
            const serieCorrelativoMatch = search.match(/^([a-zA-Z0-9]{4})-(\d+)$/);

            if (serieCorrelativoMatch) {
                where.serie = serieCorrelativoMatch[1];
                where.correlativo = parseInt(serieCorrelativoMatch[2], 10);
            } else {
                const searchNumber = !isNaN(Number(search)) ? Number(search) : undefined;

                where.OR = [
                    // Search by Recipient Name
                    { destinatarioRazonSocial: { contains: search, mode: 'insensitive' } },
                    // Search by Recipient Document Number
                    { destinatarioNumDoc: { contains: search } },
                    // Search by Serie
                    { serie: { contains: search, mode: 'insensitive' } },
                ];

                // Search by Correlativo if it's a number
                if (searchNumber !== undefined) {
                    where.OR.push({ correlativo: searchNumber });
                }
            }
        }

        if (filters.fechaInicio && filters.fechaFin) {
            where.fechaEmision = {
                gte: new Date(filters.fechaInicio),
                lte: new Date(filters.fechaFin),
            };
        }

        const [guias, total] = await Promise.all([
            this.prisma.guiaRemision.findMany({
                where,
                skip,
                take: limit,
                include: {
                    detalles: true,
                    empresa: true,
                    cliente: true,
                },
                orderBy: {
                    fechaEmision: 'desc',
                },
            }),
            this.prisma.guiaRemision.count({ where }),
        ]);

        return {
            data: guias,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async findOne(id: number, empresaId: number) {
        const guia = await this.prisma.guiaRemision.findFirst({
            where: { id, empresaId },
            include: {
                detalles: {
                    include: {
                        producto: true,
                    },
                },
                empresa: true,
                cliente: true,
                usuario: {
                    select: {
                        id: true,
                        nombre: true,
                        email: true,
                    },
                },
            },
        });

        if (!guia) {
            throw new NotFoundException(`Guía de remisión con ID ${id} no encontrada`);
        }

        return guia;
    }

    async update(id: number, updateDto: UpdateGuiaRemisionDto, empresaId: number) {
        const guia = await this.findOne(id, empresaId);

        // No permitir actualizar si ya fue enviada a SUNAT
        if (guia.estadoSunat !== 'PENDIENTE') {
            throw new ForbiddenException(
                'No se puede actualizar una guía que ya fue enviada a SUNAT',
            );
        }

        // Si se actualizan detalles, eliminar los anteriores y crear los nuevos
        const { detalles, ...guiaData } = updateDto;

        const dataToUpdate: any = {
            ...guiaData,
        };

        if (guiaData.fechaEmision) {
            dataToUpdate.fechaEmision = new Date(guiaData.fechaEmision);
        }

        if (guiaData.fechaInicioTraslado) {
            dataToUpdate.fechaInicioTraslado = new Date(guiaData.fechaInicioTraslado);
        }

        if (detalles && detalles.length > 0) {
            // Eliminar detalles anteriores y crear los nuevos
            await this.prisma.detalleGuiaRemision.deleteMany({
                where: { guiaRemisionId: id },
            });

            dataToUpdate.detalles = {
                create: detalles.map((detalle, index) => ({
                    numeroOrden: index + 1,
                    codigoProducto: detalle.codigoProducto,
                    descripcion: detalle.descripcion,
                    cantidad: detalle.cantidad,
                    unidadMedida: detalle.unidadMedida || 'NIU',
                    productoId: detalle.productoId,
                })),
            };
        }

        const guiaActualizada = await this.prisma.guiaRemision.update({
            where: { id },
            data: dataToUpdate,
            include: {
                detalles: {
                    include: {
                        producto: true,
                    },
                },
                empresa: true,
                cliente: true,
            },
        });

        return guiaActualizada;
    }

    async remove(id: number, empresaId: number) {
        const guia = await this.findOne(id, empresaId);

        // No permitir eliminar si ya fue enviada a SUNAT (mejor anular)
        if (guia.estadoSunat === 'EMITIDO') {
            throw new ForbiddenException(
                'No se puede eliminar una guía emitida. Use la opción de anular.',
            );
        }

        await this.prisma.guiaRemision.delete({
            where: { id },
        });

        return { message: 'Guía de remisión eliminada correctamente' };
    }

    async enviarSunat(id: number, empresaId: number) {
        const guia = await this.findOne(id, empresaId);

        // Obtener credenciales de la empresa
        const empresa = await this.prisma.empresa.findUnique({
            where: { id: empresaId },
            select: { providerId: true, providerToken: true }
        });

        if (!empresa?.providerId || !empresa?.providerToken) {
            throw new BadRequestException('La empresa no tiene configuradas las credenciales de facturación electrónica (providerId/Token)');
        }

        // Validar que esté pendiente
        if (guia.estadoSunat !== 'PENDIENTE') {
            throw new BadRequestException(
                `La guía ya fue procesada. Estado actual: ${guia.estadoSunat}`,
            );
        }

        try {
            // Transformar a formato SUNAT y enviar
            const resultado = await this.sunatGuiaService.enviarGuia(
                guia,
                empresa.providerId,
                empresa.providerToken,
            );

            // Actualizar guía con respuesta de SUNAT
            const guiaActualizada = await this.prisma.guiaRemision.update({
                where: { id },
                data: {
                    estadoSunat: resultado.success ? 'ENVIADO' : 'FALLIDO_ENVIO',
                    sunatXml: resultado.xml,
                    sunatCdrResponse: resultado.cdrResponse,
                    sunatCdrZip: resultado.cdrZip,
                    sunatErrorMsg: resultado.error,
                    documentoId: resultado.documentoId,
                    s3XmlUrl: resultado.s3XmlUrl,
                    s3CdrUrl: resultado.s3CdrUrl,
                    s3PdfUrl: resultado.s3PdfUrl,
                },
            });

            return {
                success: resultado.success,
                guia: guiaActualizada,
                message: resultado.message,
            };
        } catch (error) {
            // Actualizar estado a fallido
            await this.prisma.guiaRemision.update({
                where: { id },
                data: {
                    estadoSunat: 'FALLIDO_ENVIO',
                    sunatErrorMsg: error.message,
                },
            });

            throw error;
        }
    }

    private validateModoTransporte(dto: CreateGuiaRemisionDto | UpdateGuiaRemisionDto) {
        // Validar que si es transporte público, tenga datos del transportista
        if (dto.modoTransporte === '01') {
            // Transporte público
            if (!dto.transportistaRuc || !dto.transportistaRazonSocial) {
                throw new BadRequestException(
                    'Para transporte público se requieren los datos del transportista',
                );
            }
        }

        // Validar que si es transporte privado, tenga datos del conductor/vehículo
        if (dto.modoTransporte === '02') {
            // Transporte privado
            if (!dto.conductorNumDoc || !dto.vehiculoPlaca) {
                throw new BadRequestException(
                    'Para transporte privado se requieren los datos del conductor y vehículo',
                );
            }
        }
    }

    private getCurrentTime(): string {
        const now = new Date();
        return now.toTimeString().split(' ')[0]; // HH:MM:SS
    }

    async getNextCorrelativo(serie: string, empresaId: number): Promise<number> {
        const ultimaGuia = await this.prisma.guiaRemision.findFirst({
            where: {
                empresaId,
                serie,
            },
            orderBy: {
                correlativo: 'desc',
            },
        });

        return ultimaGuia ? ultimaGuia.correlativo + 1 : 1;
    }
}
