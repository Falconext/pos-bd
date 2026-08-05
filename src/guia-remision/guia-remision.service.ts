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
import * as XLSX from 'xlsx';

@Injectable()
export class GuiaRemisionService {
  private readonly logger = new Logger(GuiaRemisionService.name);
  private readonly MAX_DATA_ERROR_RETRIES = 5;
  private readonly MAX_INFRA_ERROR_RETRIES = 30;

  constructor(
    private prisma: PrismaService,
    private sunatGuiaService: SunatGuiaService,
    private pdfGeneratorService: PdfGeneratorService,
  ) {}

  async create(
    createDto: CreateGuiaRemisionDto,
    empresaId: number,
    usuarioId?: number,
    sedeId?: number,
  ) {
    const tipoDocumento = createDto.tipoGuia === 'TRANSPORTISTA' ? '31' : '09';
    const serieConfigurada = await this.prisma.empresaSerie.findFirst({
      where: { empresaId, tipoDoc: tipoDocumento, activo: true },
      orderBy: { id: 'asc' },
    });
    if (serieConfigurada?.serie) {
      createDto.serie = serieConfigurada.serie;
    }

    // Resolver correlativo: siempre usar el siguiente al MAX existente en BD para
    // esta serie, ignorando el valor enviado si ya está ocupado. Esto evita errores
    // de "numeración repetida" tanto en nuestra BD como en SUNAT (error 1033).
    const ultimaGuia = await this.prisma.guiaRemision.findFirst({
      where: { empresaId, serie: createDto.serie },
      orderBy: { correlativo: 'desc' },
      select: { correlativo: true },
    });
    const maxCorrelativo = ultimaGuia?.correlativo ?? 0;
    const correlativoMinimo = serieConfigurada?.correlativo ?? 1;

    // Si el correlativo enviado es mayor al máximo existente, lo respetamos.
    // En cualquier otro caso (no enviado, ya ocupado, o menor al máximo) usamos MAX+1.
    if (
      !createDto.correlativo ||
      createDto.correlativo <= maxCorrelativo ||
      createDto.correlativo < correlativoMinimo
    ) {
      if (createDto.correlativo && createDto.correlativo <= maxCorrelativo) {
        this.logger.warn(
          `Correlativo ${createDto.serie}-${createDto.correlativo} ya existe en BD. ` +
            `Auto-avanzando a ${maxCorrelativo + 1}.`,
        );
      }
      createDto.correlativo = Math.max(maxCorrelativo + 1, correlativoMinimo);
    }

    // Validaciones de negocio
    this.validateGuiaRemision(createDto);

    // Extraer detalles para crear por separado
    const { detalles, ...guiaData } = createDto;

    // Asegurar que correlativo esté definido
    const correlativoFinal = createDto.correlativo;

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

  async findAll(
    query: QueryGuiaRemisionDto,
    empresaId: number,
    sedeId?: number,
  ) {
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
        {
          destinatarioRazonSocial: {
            contains: filters.destinatario,
            mode: 'insensitive',
          },
        },
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
        const searchNumber = !isNaN(Number(search))
          ? Number(search)
          : undefined;

        where.OR = [
          // Search by Recipient Name
          {
            destinatarioRazonSocial: { contains: search, mode: 'insensitive' },
          },
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
      throw new NotFoundException(
        `Guía de remisión con ID ${id} no encontrada`,
      );
    }

    return guia;
  }

  async update(
    id: number,
    updateDto: UpdateGuiaRemisionDto,
    empresaId: number,
    sedeId?: number,
  ) {
    const guia = await this.findOne(id, empresaId, sedeId);

    // No permitir actualizar si ya fue aceptada/emitida
    const estadosNoEditables = ['ACEPTADO', 'EMITIDO'];
    if (estadosNoEditables.includes(guia.estadoSunat)) {
      throw new ForbiddenException(
        'No se puede actualizar una guía que ya fue aceptada por SUNAT',
      );
    }

    // Validar el RESULTADO de la edición (guía existente + cambios) para no
    // reenviar a SUNAT datos inválidos (p. ej. transportista = remitente en
    // transporte público → error 2560). Se valida el merge porque updateDto
    // es parcial.
    this.validateGuiaRemision({ ...guia, ...updateDto } as any);

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

  async syncEstadoSunat(
    id: number,
    body: any,
    empresaId: number,
    sedeId?: number,
  ) {
    await this.findOne(id, empresaId, sedeId);

    const estado = String(body?.estadoSunat || '').toUpperCase();
    const estadosPermitidos = [
      'PENDIENTE',
      'ENVIADO',
      'EMITIDO',
      'RECHAZADO',
      'FALLIDO_ENVIO',
    ];
    if (!estadosPermitidos.includes(estado)) {
      throw new BadRequestException(
        'Estado SUNAT inválido para guía de remisión.',
      );
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
    const empresa = (await (this.prisma.empresa as any).findUnique({
      where: { id: empresaId },
      select: {
        usuarioPse: true,
        contrasenaPse: true,
        usaDemo: true,
      },
    })) as {
      usuarioPse: string | null;
      contrasenaPse: string | null;
      usaDemo: boolean;
    } | null;
    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }
    const usaDemo = empresa?.usaDemo ?? false;

    if (!empresa?.usuarioPse || !empresa?.contrasenaPse) {
      throw new BadRequestException(
        'La empresa no tiene configuradas las credenciales QPSE (usuarioPse / contrasenaPse). ' +
          'Configúralas en Configuración → Empresa → pestaña SUNAT.',
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
        empresa.usuarioPse || '',
        empresa.contrasenaPse || '',
        usaDemo,
      );

      // Auto-avance de correlativo cuando SUNAT reporta numeración repetida.
      // Se repite MIENTRAS siga chocando: si SUNAT tiene correlativos que la BD
      // local no registra (p. ej. un número aceptado cuyo registro local se
      // perdió), un solo avance volvería a colisionar. Acotado a 10 intentos.
      let intentosAvance = 0;
      while (resultado.numeracionRepetida && intentosAvance < 10) {
        intentosAvance++;

        const ultimaGuia = await this.prisma.guiaRemision.findFirst({
          where: { empresaId, serie: guia.serie },
          orderBy: { correlativo: 'desc' },
          select: { correlativo: true },
        });
        // Avanza siempre por encima del propio correlativo actual para garantizar
        // progreso aunque el MAX de BD ya lo incluya.
        const nuevoCorrelativo =
          Math.max(ultimaGuia?.correlativo ?? 0, guiaParaEnviar.correlativo) + 1;
        this.logger.warn(
          `Numeración repetida (${guia.serie}-${guiaParaEnviar.correlativo}). ` +
            `Auto-avanzando a ${guia.serie}-${nuevoCorrelativo} (intento ${intentosAvance}/10).`,
        );

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
          empresa.usuarioPse || '',
          empresa.contrasenaPse || '',
          usaDemo,
        );
      }

      // Rechazo DEFINITIVO de SUNAT: recibió y procesó la guía y la rechazó
      // (devuelve CDR). Reintentar los mismos datos inválidos siempre volverá
      // a fallar → RECHAZADO (sin reintentos). FALLIDO_ENVIO se reserva para
      // fallos transitorios (no se pudo enviar / SUNAT caída), que sí reintentan.
      const esRechazoDefinitivo =
        !resultado.success &&
        !resultado.pendienteVerificacion &&
        !!resultado.cdrResponse;

      const nuevoEstado = resultado.success
        ? 'EMITIDO'
        : resultado.pendienteVerificacion
          ? 'PENDIENTE'
          : esRechazoDefinitivo
            ? 'RECHAZADO'
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
          // Éxito o rechazo definitivo: cortar reintentos.
          ...(resultado.success && {
            sunatRetriesCount: 0,
            sunatNextRetryAt: null,
          }),
          ...(esRechazoDefinitivo && { sunatNextRetryAt: null }),
        },
      });

      return {
        success: resultado.success,
        guia: guiaActualizada,
        message: resultado.message,
      };
    } catch (error: any) {
      this.logger.error(
        `🚫 Error enviando guía ${id} a SUNAT: ${error.message}`,
      );

      try {
        const current = await this.prisma.guiaRemision.findUnique({
          where: { id },
          select: { sunatRetriesCount: true },
        });

        if (current) {
          const newRetryCount = (current.sunatRetriesCount || 0) + 1;
          const errorType = this.classifyError(error);
          const maxRetries =
            errorType === 'DATOS'
              ? this.MAX_DATA_ERROR_RETRIES
              : this.MAX_INFRA_ERROR_RETRIES;

          if (newRetryCount < maxRetries) {
            const nextRetry =
              errorType === 'DATOS'
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
            this.logger.log(
              `📅 Guía ${id} → reintento #${newRetryCount} [${errorType}] en ${nextRetry.toISOString()}`,
            );
          } else {
            await this.prisma.guiaRemision.update({
              where: { id },
              data: {
                estadoSunat: 'RECHAZADO' as any,
                sunatNextRetryAt: null,
                sunatErrorMsg: `[${errorType}] Fallido tras ${newRetryCount} intentos: ${error.message}`,
              },
            });
            this.logger.error(
              `❌ Guía ${id} → RECHAZADO (agotó ${maxRetries} reintentos [${errorType}])`,
            );
          }
        }
      } catch (dbErr) {
        this.logger.error(
          `Error guardando estado de fallo de guía ${id}:`,
          dbErr,
        );
      }

      const finalErrorType = this.classifyError(error);
      if (finalErrorType === 'RED') {
        return {
          success: true,
          message:
            'Guía guardada correctamente. SUNAT no está disponible en este momento; la confirmación llegará automáticamente cuando el servicio se restablezca.',
          estado: 'PENDIENTE',
        };
      }

      const rawMsg =
        error.response?.data?.message ||
        error.message ||
        'Error al enviar a SUNAT';
      throw new HttpException(
        `Error al enviar la guía a SUNAT: ${rawMsg}`,
        502,
      );
    }
  }

  private classifyError(err: any): 'DATOS' | 'RED' {
    const msg = String(err?.message || '').toLowerCase();
    const httpStatus = err?.status || err?.response?.status;

    if (
      msg.includes('qpse rechaz') ||
      msg.includes('apisunat rechaz') ||
      msg.includes('rechazó el documento')
    )
      return 'DATOS';
    if (
      msg.includes('no se puede leer') ||
      msg.includes('parsear') ||
      msg.includes('xml') ||
      msg.includes('ubl') ||
      msg.includes('cvc-')
    )
      return 'DATOS';
    if (httpStatus && httpStatus >= 400 && httpStatus < 500) return 'DATOS';

    return 'RED';
  }

  private calculateDataRetry(currentRetryCount: number): Date {
    const backoffMinutes = [1, 2, 5, 15, 30, 60, 120, 180, 240, 300];
    const minutes =
      backoffMinutes[Math.min(currentRetryCount, backoffMinutes.length - 1)];
    const next = new Date();
    next.setMinutes(next.getMinutes() + minutes);
    return next;
  }

  private calculateNetworkRetry(currentRetryCount: number): Date {
    const backoffMinutes = [5, 15, 60, 240, 720, 1440];
    const minutes =
      backoffMinutes[Math.min(currentRetryCount, backoffMinutes.length - 1)];
    const next = new Date();
    next.setMinutes(next.getMinutes() + minutes);
    return next;
  }

  private validateGuiaRemision(
    dto: CreateGuiaRemisionDto | UpdateGuiaRemisionDto,
  ) {
    // Traslado entre establecimientos de la misma empresa: destinatario debe ser la misma empresa
    const tipoTraslado = (dto as any).tipoTraslado;
    const remitenteRuc = String((dto as any).remitenteRuc || '').trim();
    if (tipoTraslado === '04' && remitenteRuc) {
      const destinatarioDoc = String(dto.destinatarioNumDoc || '').trim();
      if (destinatarioDoc !== remitenteRuc) {
        throw new BadRequestException(
          'Para traslado entre establecimientos de la misma empresa, el destinatario debe ser la misma empresa (mismo RUC del remitente).',
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
      if (
        !dto.conductorNumDoc ||
        !dto.conductorNombre ||
        !dto.conductorApellidos ||
        !dto.conductorLicencia ||
        !dto.vehiculoPlaca
      ) {
        throw new BadRequestException(
          'Para GRE-T se requieren datos de conductor (doc, nombre, apellidos, licencia) y vehículo (placa)',
        );
      }

      const licencia = String(dto.conductorLicencia || '')
        .trim()
        .toUpperCase();
      if (!/^[A-Z0-9]{9}$/.test(licencia)) {
        throw new BadRequestException(
          'La licencia del conductor debe tener exactamente 9 caracteres alfanuméricos.',
        );
      }

      const placa = String(dto.vehiculoPlaca || '').trim();
      if (placa.length < 6) {
        throw new BadRequestException(
          'La placa del vehículo debe tener al menos 6 caracteres.',
        );
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
      // SUNAT (cód. 2560): en transporte público el transportista debe ser un
      // TERCERO distinto al remitente. Si el propio remitente traslada su
      // mercadería, debe usar Transporte Privado (02) con placa y conductor.
      const transportistaRucPublico = String(dto.transportistaRuc || '').trim();
      if (
        remitenteRuc &&
        transportistaRucPublico &&
        transportistaRucPublico === remitenteRuc
      ) {
        throw new BadRequestException(
          'En transporte público el transportista debe ser un tercero distinto al remitente. ' +
            'Si tú mismo trasladas la mercadería, usa Transporte Privado (indica placa y conductor del vehículo).',
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
      '03': 'VENTA CON ENTREGA A TERCEROS',
      '04': 'TRASLADO ENTRE ESTABLECIMIENTOS DE LA MISMA EMPRESA',
      '05': 'CONSIGNACION',
      '06': 'DEVOLUCION',
      '07': 'RECOJO DE BIENES TRANSFORMADOS',
      '08': 'IMPORTACION',
      '09': 'EXPORTACION',
      '13': 'OTROS',
      '14': 'VENTA SUJETA A CONFIRMACION DEL COMPRADOR',
      '17': 'TRASLADO DE BIENES PARA TRANSFORMACION',
      '18': 'TRASLADO POR EMISOR ITINERANTE DE COMPROBANTES DE PAGO',
      '19': 'TRASLADO DE MERCANCIA EXTRANJERA',
    };

    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { rubro: true },
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
      logoSize: (empresa as any).ticketLogoSize ?? 96,

      // Documento
      ruc: empresa.ruc,
      serie: guia.serie,
      correlativo: String(guia.correlativo).padStart(8, '0'),
      fechaEmision: formatDate(guia.fechaEmision),
      fechaTraslado: formatDate(guia.fechaInicioTraslado),
      // @ts-ignore: tipoTraslado might be property on guia
      motivoTraslado:
        motivosTraslado[guia['tipoTraslado']] ||
        guia['tipoTraslado'] ||
        'VENTA',
      modalidadTraslado:
        modosTransporte[guia.modoTransporte] || guia.modoTransporte,
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

  /**
   * Precarga los datos de una guía a partir de un comprobante (Factura/Boleta)
   * ya emitido: destinatario (desde el cliente), punto de llegada y los ítems
   * (descripción, cantidad y unidad). Devuelve un objeto parcial listo para
   * fusionar en el formulario de creación de guía; NO crea la guía.
   */
  async getPrefillDesdeComprobante(
    comprobanteId: number,
    empresaId: number,
    sedeId?: number,
  ) {
    const comprobante = await this.prisma.comprobante.findFirst({
      where: {
        id: comprobanteId,
        empresaId,
        ...(sedeId ? { sedeId } : {}),
      },
      include: {
        cliente: {
          include: { tipoDocumento: true },
        },
        detalles: {
          include: { producto: true },
        },
      },
    });

    if (!comprobante) {
      throw new NotFoundException(
        `Comprobante con ID ${comprobanteId} no encontrado`,
      );
    }

    const cliente = comprobante.cliente;
    const numDoc = String(cliente?.nroDoc || '').trim();
    // Tipo de documento del destinatario (Catálogo 6): 11 díg. = RUC (6),
    // 8 díg. = DNI (1); cualquier otro largo se deja como el que tenga el cliente.
    const destinatarioTipoDoc =
      numDoc.length === 11 ? '6' : numDoc.length === 8 ? '1' : '6';

    const tipoLabels: Record<string, string> = {
      '01': 'FACTURA',
      '03': 'BOLETA',
      '07': 'NOTA DE CREDITO',
      '08': 'NOTA DE DEBITO',
    };
    const refLabel = tipoLabels[comprobante.tipoDoc] || 'COMPROBANTE';

    return {
      clienteId: cliente?.id,
      destinatarioTipoDoc,
      destinatarioNumDoc: numDoc,
      destinatarioRazonSocial: cliente?.nombre || '',
      llegadaDireccion: cliente?.direccion || '',
      llegadaUbigeo: cliente?.ubigeo || '',
      observaciones: `Ref. ${refLabel} ${comprobante.serie}-${String(
        comprobante.correlativo,
      ).padStart(8, '0')}`,
      comprobanteRef: {
        id: comprobante.id,
        tipoDoc: comprobante.tipoDoc,
        serie: comprobante.serie,
        correlativo: comprobante.correlativo,
      },
      detalles: comprobante.detalles.map((d) => ({
        productoId: d.productoId ?? undefined,
        codigoProducto: d.producto?.codigo || String(d.productoId ?? ''),
        descripcion: d.descripcion,
        cantidad: Number(d.cantidad),
        unidadMedida: d.unidad || 'NIU',
      })),
    };
  }

  /** Genera la plantilla .xlsx (buffer) para importar ítems de la guía. */
  plantillaItems(): Buffer {
    const ejemplo = [
      {
        Codigo: 'P001',
        Descripcion: 'Producto de ejemplo',
        Cantidad: 2,
        Unidad: 'NIU',
      },
      {
        Codigo: 'P002',
        Descripcion: 'Segundo bien a trasladar',
        Cantidad: 1,
        Unidad: 'NIU',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(ejemplo);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Items');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  }

  /**
   * Parsea un Excel/CSV (base64) con los ítems de la guía y devuelve la lista
   * de detalles lista para el formulario. Sigue el patrón de ImportarService:
   * lee la primera hoja y normaliza los encabezados.
   */
  importarItems(archivoBase64: string): {
    items: {
      codigoProducto: string;
      descripcion: string;
      cantidad: number;
      unidadMedida: string;
    }[];
    errores: { fila: number; motivo: string }[];
  } {
    let filas: Record<string, any>[];
    try {
      const base64 = String(archivoBase64 || '').replace(
        /^data:[^;]+;base64,/,
        '',
      );
      const buffer = Buffer.from(base64, 'base64');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
        defval: null,
        raw: false,
      });
      filas = raw.map((f) => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(f)) {
          const key = k
            .toString()
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, '');
          out[key] = typeof v === 'string' ? v.trim() : v;
        }
        return out;
      });
    } catch {
      throw new BadRequestException(
        'No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) o CSV válido.',
      );
    }

    const pick = (fila: Record<string, any>, claves: string[]): any => {
      for (const c of claves) {
        if (fila[c] != null && fila[c] !== '') return fila[c];
      }
      return null;
    };

    const items: {
      codigoProducto: string;
      descripcion: string;
      cantidad: number;
      unidadMedida: string;
    }[] = [];
    const errores: { fila: number; motivo: string }[] = [];

    filas.forEach((fila, i) => {
      const nFila = i + 2; // encabezado + base 1
      const descripcion = pick(fila, ['descripcion', 'descripción', 'detalle']);
      const cantidad = Number(
        pick(fila, ['cantidad', 'cant', 'qty']) ?? 0,
      );
      if (!descripcion) {
        errores.push({ fila: nFila, motivo: 'Falta la Descripción' });
        return;
      }
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        errores.push({ fila: nFila, motivo: 'Cantidad inválida (debe ser > 0)' });
        return;
      }
      items.push({
        codigoProducto: String(
          pick(fila, ['codigo', 'código', 'cod', 'sku']) ?? '',
        ),
        descripcion: String(descripcion),
        cantidad,
        unidadMedida: String(
          pick(fila, ['unidad', 'unidadmedida', 'und', 'um']) ?? 'NIU',
        ).toUpperCase(),
      });
    });

    return { items, errores };
  }

  async getNextCorrelativo(serie: string, empresaId: number): Promise<number> {
    const serieBase = String(serie || '')
      .trim()
      .toUpperCase();
    const tipoDoc = serieBase.startsWith('V') ? '31' : '09';
    const serieConfigurada = await this.prisma.empresaSerie.findFirst({
      where: { empresaId, tipoDoc, activo: true },
      orderBy: { id: 'asc' },
    });
    const serieFinal = serieConfigurada?.serie || serieBase;
    const ultimaGuia = await this.prisma.guiaRemision.findFirst({
      where: {
        empresaId,
        serie: serieFinal,
      },
      orderBy: {
        correlativo: 'desc',
      },
    });

    return Math.max(
      ultimaGuia ? ultimaGuia.correlativo + 1 : 1,
      serieConfigurada?.correlativo ?? 1,
    );
  }
}
