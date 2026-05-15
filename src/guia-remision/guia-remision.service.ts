import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    HttpException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGuiaRemisionDto } from './dto/create-guia-remision.dto';
import { UpdateGuiaRemisionDto } from './dto/update-guia-remision.dto';
import { QueryGuiaRemisionDto } from './dto/query-guia-remision.dto';
import { SunatGuiaService } from './sunat-guia.service';
import { PdfGeneratorService } from '../comprobante/pdf-generator.service';

@Injectable()
export class GuiaRemisionService {
    private readonly logger = new Logger(GuiaRemisionService.name);
    private readonly MAX_DATA_ERROR_RETRIES = 5;
    private readonly MAX_INFRA_ERROR_RETRIES = 30;

    constructor(
        private prisma: PrismaService,
        private sunatGuiaService: SunatGuiaService,
        private pdfGeneratorService: PdfGeneratorService,
    ) { }

    async create(createDto: CreateGuiaRemisionDto, empresaId: number, usuarioId?: number, sedeId?: number) {
        // Resolver correlativo: siempre usar el siguiente al MAX existente en BD para
        // esta serie, ignorando el valor enviado si ya está ocupado. Esto evita errores
        // de "numeración repetida" tanto en nuestra BD como en SUNAT (error 1033).
        const ultimaGuia = await this.prisma.guiaRemision.findFirst({
            where: { empresaId, serie: createDto.serie },
            orderBy: { correlativo: 'desc' },
            select: { correlativo: true },
        });
        const maxCorrelativo = ultimaGuia?.correlativo ?? 0;

        // Si el correlativo enviado es mayor al máximo existente, lo respetamos.
        // En cualquier otro caso (no enviado, ya ocupado, o menor al máximo) usamos MAX+1.
        if (!createDto.correlativo || createDto.correlativo <= maxCorrelativo) {
            if (createDto.correlativo && createDto.correlativo <= maxCorrelativo) {
                this.logger.warn(
                    `Correlativo ${createDto.serie}-${createDto.correlativo} ya existe en BD. ` +
                    `Auto-avanzando a ${maxCorrelativo + 1}.`
                );
            }
            createDto.correlativo = maxCorrelativo + 1;
        }

        // Validaciones de negocio
        this.validateGuiaRemision(createDto);

        // Extraer detalles para crear por separado
        const { detalles, ...guiaData } = createDto;

        // Asegurar que correlativo esté definido
        const correlativoFinal = createDto.correlativo!;

        // Determinar tipoDocumento según tipoGuia
        const tipoDocumento = createDto.tipoGuia === 'TRANSPORTISTA' ? '31' : '09';

        // Crear guía de remisión
        // Crear guía de remisión con reintento por si hay colisión de correlativo
        try {
            const guia = await this.prisma.guiaRemision.create({
                data: {
                    ...guiaData,
                    correlativo: correlativoFinal,
                    tipoDocumento,
                    empresaId,
                    sedeId,
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
                        tipoDocumento,
                        empresaId,
                        sedeId,
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

    async findAll(query: QueryGuiaRemisionDto, empresaId: number, sedeId?: number) {
        const { page = 1, limit = 10, ...filters } = query;
        const skip = (page - 1) * limit;

        // Principal sede: include legacy records with sedeId=null (created before JWT sedeId fix)
        let sedeFilter: any = {};
        if (sedeId) {
            const esPrincipal = await this.prisma.sede.findFirst({
                where: { empresaId, id: sedeId, esPrincipal: true },
                select: { id: true },
            });
            if (esPrincipal) {
                sedeFilter = { AND: [{ OR: [{ sedeId }, { sedeId: null }] }] };
            } else {
                sedeFilter = { sedeId };
            }
        }

        const where: any = { empresaId, ...sedeFilter };

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

    async findOne(id: number, empresaId: number, sedeId?: number) {
        const guia = await this.prisma.guiaRemision.findFirst({
            where: { id, empresaId, ...(sedeId ? { sedeId } : {}) },
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

    async update(id: number, updateDto: UpdateGuiaRemisionDto, empresaId: number, sedeId?: number) {
        const guia = await this.findOne(id, empresaId, sedeId);

        // No permitir actualizar si ya fue aceptada/emitida
        const estadosNoEditables = ['ACEPTADO', 'EMITIDO'];
        if (estadosNoEditables.includes(guia.estadoSunat)) {
            throw new ForbiddenException(
                'No se puede actualizar una guía que ya fue aceptada por SUNAT',
            );
        }

        // Si se actualizan detalles, eliminar los anteriores y crear los nuevos
        const { detalles, ...guiaData } = updateDto;

        const dataToUpdate: any = {
            ...guiaData,
            // Al editar una guía fallida o rechazada, resetear estado para que pueda re-enviarse
            ...(['FALLIDO_ENVIO', 'RECHAZADO'].includes(guia.estadoSunat)
                ? { estadoSunat: 'PENDIENTE', sunatErrorMsg: null, documentoId: null }
                : {}),
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

    async syncEstadoSunat(id: number, body: any, empresaId: number, sedeId?: number) {
        await this.findOne(id, empresaId, sedeId);

        const estado = String(body?.estadoSunat || '').toUpperCase();
        const estadosPermitidos = ['PENDIENTE', 'ENVIADO', 'EMITIDO', 'RECHAZADO', 'FALLIDO_ENVIO'];
        if (!estadosPermitidos.includes(estado)) {
            throw new BadRequestException('Estado SUNAT inválido para guía de remisión.');
        }

        return this.prisma.guiaRemision.update({
            where: { id },
            data: {
                estadoSunat: estado as any,
                sunatXml: body?.sunatXml ?? undefined,
                sunatCdrResponse: body?.sunatCdrResponse
                    ? String(body.sunatCdrResponse)
                    : undefined,
                sunatCdrZip: body?.sunatCdrZip ?? undefined,
                sunatErrorMsg: body?.sunatErrorMsg ?? null,
                documentoId: body?.documentoId ? String(body.documentoId) : undefined,
            },
        });
    }

    async remove(id: number, empresaId: number, sedeId?: number) {
        const guia = await this.findOne(id, empresaId, sedeId);

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

    async enviarSunat(id: number, empresaId: number, sedeId?: number) {
        const guia = await this.findOne(id, empresaId, sedeId);

        // Obtener credenciales QPSE de la empresa
        const empresa = await (this.prisma.empresa as any).findUnique({
            where: { id: empresaId },
            select: { usuarioPse: true, contrasenaPse: true, usaDemo: true },
        }) as { usuarioPse: string | null; contrasenaPse: string | null; usaDemo: boolean } | null;
        const usaDemo = empresa?.usaDemo ?? false;

        if (!empresa?.usuarioPse || !empresa?.contrasenaPse) {
            throw new BadRequestException(
                'La empresa no tiene configuradas las credenciales QPSE (usuarioPse / contrasenaPse). ' +
                'Configúralas en Configuración → Empresa → pestaña SUNAT.'
            );
        }

        // Validar estado enviable
        if (!['PENDIENTE', 'FALLIDO_ENVIO'].includes(guia.estadoSunat)) {
            throw new BadRequestException(
                `La guía ya fue procesada. Estado actual: ${guia.estadoSunat}`,
            );
        }

        try {
            let guiaParaEnviar = guia;
            let resultado = await this.sunatGuiaService.enviarGuia(
                guiaParaEnviar,
                empresa.usuarioPse,
                empresa.contrasenaPse,
                usaDemo,
            );

            // Auto-avance de correlativo cuando SUNAT reporta numeración repetida
            if (resultado.numeracionRepetida) {
                this.logger.warn(
                    `Numeración repetida (${guia.serie}-${guia.correlativo}). ` +
                    `Buscando siguiente correlativo disponible…`
                );

                const ultimaGuia = await this.prisma.guiaRemision.findFirst({
                    where: { empresaId, serie: guia.serie },
                    orderBy: { correlativo: 'desc' },
                    select: { correlativo: true },
                });
                const nuevoCorrelativo = (ultimaGuia?.correlativo ?? 0) + 1;
                this.logger.log(`Nuevo correlativo asignado a guía ${id}: ${guia.serie}-${nuevoCorrelativo}`);

                const guiaConNuevoCorrelativo = await this.prisma.guiaRemision.update({
                    where: { id },
                    data: { correlativo: nuevoCorrelativo },
                    include: {
                        detalles: { include: { producto: true } },
                        empresa: true,
                        cliente: true,
                    },
                });

                guiaParaEnviar = guiaConNuevoCorrelativo as any;
                resultado = await this.sunatGuiaService.enviarGuia(
                    guiaParaEnviar,
                    empresa.usuarioPse,
                    empresa.contrasenaPse,
                    usaDemo,
                );
            }

            const nuevoEstado = resultado.success
                ? 'EMITIDO'
                : resultado.pendienteVerificacion
                    ? 'PENDIENTE'
                    : 'FALLIDO_ENVIO';

            const guiaActualizada = await this.prisma.guiaRemision.update({
                where: { id },
                data: {
                    estadoSunat: nuevoEstado as any,
                    sunatXml: resultado.xml || null,
                    sunatCdrResponse: resultado.cdrResponse || null,
                    sunatCdrZip: resultado.cdrZip || null,
                    sunatErrorMsg: resultado.error || null,
                    documentoId: resultado.documentoId || null,
                    // Resetear reintentos si hubo éxito
                    ...(resultado.success && {
                        sunatRetriesCount: 0,
                        sunatNextRetryAt: null,
                    })
                },
            });

            return {
                success: resultado.success,
                guia: guiaActualizada,
                message: resultado.message,
            };
        } catch (error: any) {
            this.logger.error(`🚫 Error enviando guía ${id} a SUNAT: ${error.message}`);

            try {
                const current = await this.prisma.guiaRemision.findUnique({
                    where: { id },
                    select: { sunatRetriesCount: true },
                });

                if (current) {
                    const newRetryCount = (current.sunatRetriesCount || 0) + 1;
                    const errorType = this.classifyError(error);
                    const maxRetries = errorType === 'DATOS'
                        ? this.MAX_DATA_ERROR_RETRIES
                        : this.MAX_INFRA_ERROR_RETRIES;

                    if (newRetryCount < maxRetries) {
                        const nextRetry = errorType === 'DATOS'
                            ? this.calculateDataRetry(newRetryCount)
                            : this.calculateNetworkRetry(newRetryCount);

                        await this.prisma.guiaRemision.update({
                            where: { id },
                            data: {
                                estadoSunat: 'FALLIDO_ENVIO' as any,
                                sunatRetriesCount: newRetryCount,
                                sunatLastRetryAt: new Date(),
                                sunatNextRetryAt: nextRetry,
                                sunatErrorMsg: `[${errorType}] (intento ${newRetryCount}/${maxRetries}): ${error.message}`,
                            },
                        });
                        this.logger.log(`📅 Guía ${id} → reintento #${newRetryCount} [${errorType}] en ${nextRetry.toISOString()}`);
                    } else {
                        await this.prisma.guiaRemision.update({
                            where: { id },
                            data: {
                                estadoSunat: 'RECHAZADO' as any,
                                sunatNextRetryAt: null,
                                sunatErrorMsg: `[${errorType}] Fallido tras ${newRetryCount} intentos: ${error.message}`,
                            },
                        });
                        this.logger.error(`❌ Guía ${id} → RECHAZADO (agotó ${maxRetries} reintentos [${errorType}])`);
                    }
                }
            } catch (dbErr) {
                this.logger.error(`Error guardando estado de fallo de guía ${id}:`, dbErr);
            }

            const finalErrorType = this.classifyError(error);
            if (finalErrorType === 'RED') {
                return {
                    success: true,
                    message: 'Guía guardada correctamente. SUNAT no está disponible en este momento; la confirmación llegará automáticamente cuando el servicio se restablezca.',
                    estado: 'PENDIENTE',
                };
            }

            const rawMsg = error.response?.data?.message || error.message || 'Error al enviar a SUNAT';
            throw new HttpException(`Error al enviar la guía a SUNAT: ${rawMsg}`, 502);
        }
    }

    private classifyError(err: any): 'DATOS' | 'RED' {
        const msg = String(err?.message || '').toLowerCase();
        const httpStatus = err?.status || err?.response?.status;

        if (msg.includes('qpse rechaz') || msg.includes('rechazó el documento')) return 'DATOS';
        if (msg.includes('no se puede leer') || msg.includes('parsear') ||
            msg.includes('xml') || msg.includes('ubl') || msg.includes('cvc-')) return 'DATOS';
        if (httpStatus && httpStatus >= 400 && httpStatus < 500) return 'DATOS';

        return 'RED';
    }

    private calculateDataRetry(currentRetryCount: number): Date {
        const backoffMinutes = [1, 2, 5, 15, 30, 60, 120, 180, 240, 300];
        const minutes = backoffMinutes[Math.min(currentRetryCount, backoffMinutes.length - 1)];
        const next = new Date();
        next.setMinutes(next.getMinutes() + minutes);
        return next;
    }

    private calculateNetworkRetry(currentRetryCount: number): Date {
        const backoffMinutes = [5, 15, 60, 240, 720, 1440];
        const minutes = backoffMinutes[Math.min(currentRetryCount, backoffMinutes.length - 1)];
        const next = new Date();
        next.setMinutes(next.getMinutes() + minutes);
        return next;
    }

    private validateGuiaRemision(dto: CreateGuiaRemisionDto | UpdateGuiaRemisionDto) {
        // Traslado entre establecimientos de la misma empresa: destinatario debe ser la misma empresa
        const tipoTraslado = (dto as any).tipoTraslado;
        const remitenteRuc = String((dto as any).remitenteRuc || '').trim();
        if (tipoTraslado === '04' && remitenteRuc) {
            const destinatarioDoc = String(dto.destinatarioNumDoc || '').trim();
            if (destinatarioDoc !== remitenteRuc) {
                throw new BadRequestException(
                    'Para traslado entre establecimientos de la misma empresa, el destinatario debe ser la misma empresa (mismo RUC del remitente).'
                );
            }
        }

        // Validaciones específicas para GRE-T (Guía de Remisión Transportista)
        if (dto.tipoGuia === 'TRANSPORTISTA') {
            if (!dto.transportistaRuc || !dto.transportistaRazonSocial) {
                throw new BadRequestException(
                    'Para GRE-T se requieren datos completos del transportista (RUC y Razón Social)',
                );
            }
            // Para GRE-T, el transportista debe tener registro MTC
            if (!dto.transportistaMTC) {
                throw new BadRequestException(
                    'Para GRE-T se requiere el número de registro MTC del transportista',
                );
            }
            if (!dto.conductorNumDoc || !dto.conductorNombre || !dto.conductorApellidos || !dto.conductorLicencia || !dto.vehiculoPlaca) {
                throw new BadRequestException(
                    'Para GRE-T se requieren datos de conductor (doc, nombre, apellidos, licencia) y vehículo (placa)',
                );
            }

            const licencia = String(dto.conductorLicencia || '').trim().toUpperCase();
            if (!/^[A-Z0-9]{9}$/.test(licencia)) {
                throw new BadRequestException(
                    'La licencia del conductor debe tener exactamente 9 caracteres alfanuméricos.',
                );
            }

            const placa = String(dto.vehiculoPlaca || '').trim();
            if (placa.length < 6) {
                throw new BadRequestException('La placa del vehículo debe tener al menos 6 caracteres.');
            }

            const numeroTuc = String(dto.vehiculoAutorizacion || '').trim();
            const tucRegex = /^[A-Za-z0-9]{11,13}$/;
            if (!numeroTuc) {
                throw new BadRequestException(
                    'Para GRE-T se requiere el número correlativo de la Tarjeta Única de Circulación (11 a 13 caracteres alfanuméricos).',
                );
            }

            if (!tucRegex.test(numeroTuc)) {
                throw new BadRequestException(
                    'El número correlativo de la Tarjeta Única de Circulación debe tener entre 11 y 13 caracteres alfanuméricos.',
                );
            }
        }

        // Validaciones según modo de transporte
        if (dto.modoTransporte === '01') {
            // Transporte público
            if (!dto.transportistaRuc || !dto.transportistaRazonSocial) {
                throw new BadRequestException(
                    'Para transporte público se requieren los datos del transportista',
                );
            }
        }

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

    async generarPdf(id: number, empresaId: number, sedeId?: number) {
        const guia = await this.findOne(id, empresaId, sedeId);

        // Helper para formatear fecha
        const formatDate = (d: Date) => d.toISOString().split('T')[0];

        // Mapear modo de transporte (Catálogo 18)
        const modosTransporte: Record<string, string> = {
            '01': 'TRANSPORTE PÚBLICO',
            '02': 'TRANSPORTE PRIVADO',
        };

        // Mapear motivo de traslado (Catálogo 20)
        const motivosTraslado: Record<string, string> = {
            '01': 'VENTA',
            '02': 'COMPRA',
            '04': 'TRASLADO ENTRE ESTABLECIMIENTOS DE LA MISMA EMPRESA',
            '08': 'IMPORTACION',
            '09': 'EXPORTACION',
            '13': 'OTROS',
            '14': 'VENTA SUJETA A CONFIRMACION DEL COMPRADOR',
            '18': 'TRASLADO EMISOR ITINERANTE CP',
            '19': 'TRASLADO A ZONA PRIMARIA',
        };

        const empresa = await this.prisma.empresa.findUnique({
            where: { id: empresaId },
            include: { rubro: true }
        });

        if (!empresa) {
            throw new BadRequestException('Empresa no encontrada');
        }

        const data = {
            // Empresa
            nombreComercial: empresa.nombreComercial,
            razonSocial: empresa.razonSocial,
            direccion: empresa.direccion,
            rubro: empresa.rubro?.nombre || '',
            contacto: empresa.whatsappTienda || empresa.yapeNumero || '',
            email: '', // Empresa model currently does not have explicit email field, usually in Usuario
            logo: (() => {
              const raw = empresa.logo;
              if (!raw) return undefined;
              const t = raw.trim();
              if (t.startsWith('data:')) return t;
              if (/^https?:\/\//i.test(t) || t.startsWith('/')) return t;
              return `data:${t.startsWith('/9j/') ? 'image/jpeg' : 'image/png'};base64,${t}`;
            })(),

            // Documento
            ruc: empresa.ruc,
            serie: guia.serie,
            correlativo: String(guia.correlativo).padStart(8, '0'),
            fechaEmision: formatDate(guia.fechaEmision),
            fechaTraslado: formatDate(guia.fechaInicioTraslado),
            // @ts-ignore: tipoTraslado might be property on guia
            motivoTraslado: motivosTraslado[guia['tipoTraslado']] || guia['tipoTraslado'] || 'VENTA',
            modalidadTraslado: modosTransporte[guia.modoTransporte] || guia.modoTransporte,
            pesoTotal: guia.pesoTotal,
            unidadPeso: guia.unidadPeso === 'KGM' ? 'KG' : guia.unidadPeso,

            // Puntos
            partidaDireccion: guia.partidaDireccion,
            partidaUbigeo: guia.partidaUbigeo,
            llegadaDireccion: guia.llegadaDireccion,
            llegadaUbigeo: guia.llegadaUbigeo,

            // Destinatario
            destinatarioRazonSocial: guia.destinatarioRazonSocial,
            destinatarioNumDoc: guia.destinatarioNumDoc,

            // Transporte
            esTransportePublico: guia.modoTransporte === '01',
            transportistaRazonSocial: guia.transportistaRazonSocial,
            transportistaRuc: guia.transportistaRuc,
            vehiculoPlaca: guia.vehiculoPlaca,
            conductorNombre: guia.conductorNombre,
            conductorLicencia: guia.conductorLicencia,

            // Items
            detalles: guia.detalles.map((d, i) => ({
                item: i + 1,
                codigo: d.codigoProducto,
                descripcion: d.descripcion,
                unidad: d.unidadMedida,
                cantidad: d.cantidad,
            })),

            // Footer
            observaciones: guia.observaciones,
            qrCode: null, // TODO: Generar QR Code real
        };

        return this.pdfGeneratorService.generarPDFGuiaRemision(data);
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
