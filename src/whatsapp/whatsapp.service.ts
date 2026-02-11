import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as twilio from 'twilio';

interface EnviarComprobanteParams {
  comprobanteId: number;
  empresaId: number;
  usuarioId: number;
  numeroDestino: string;
  pdfUrl: string;
  xmlUrl?: string;
  incluyeXML: boolean;
  empresaNombre: string;
  tipoDoc: string;
  serie: string;
  correlativo: number;
  monto: number;
}

interface EnviarGuiaParams {
  guiaRemisionId: number;
  empresaId: number;
  usuarioId: number;
  numeroDestino: string;
  pdfUrl: string;
  empresaNombre: string;
  serie: string;
  correlativo: number;
  destinatario: string;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private twilioClient: twilio.Twilio;
  private whatsappNumber: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.whatsappNumber =
      this.configService.get<string>('TWILIO_WHATSAPP_NUMBER') || '';

    if (!accountSid || !authToken || !this.whatsappNumber) {
      this.logger.warn(
        '⚠️  Credenciales de Twilio no configuradas. WhatsApp deshabilitado.',
      );
    } else {
      this.twilioClient = twilio.default(accountSid, authToken);
      this.logger.log('✅ Twilio WhatsApp inicializado correctamente');
    }
  }

  /**
   * Verifica si WhatsApp está habilitado
   */
  isEnabled(): boolean {
    return !!this.twilioClient;
  }

  /**
   * Formatea número de teléfono al formato WhatsApp de Twilio
   */
  private formatearNumero(numero: string): string {
    // Eliminar espacios, guiones y caracteres especiales
    let numeroLimpio = numero.replace(/[\s\-\(\)]/g, '');

    // Si no tiene código de país, asumir Perú (+51)
    if (!numeroLimpio.startsWith('+')) {
      if (numeroLimpio.startsWith('51')) {
        numeroLimpio = '+' + numeroLimpio;
      } else if (numeroLimpio.length === 9) {
        numeroLimpio = '+51' + numeroLimpio;
      } else {
        throw new BadRequestException(
          'Número de teléfono inválido. Debe tener 9 dígitos o incluir código de país.',
        );
      }
    }

    return `whatsapp:${numeroLimpio}`;
  }

  /**
   * Genera el mensaje de WhatsApp para el comprobante
   */
  private generarMensaje(params: EnviarComprobanteParams): string {
    const {
      empresaNombre,
      tipoDoc,
      serie,
      correlativo,
      monto,
      incluyeXML,
    } = params;

    const tipoDocumento =
      tipoDoc === '01' ? 'Factura' : tipoDoc === '03' ? 'Boleta' : 'Nota';

    let mensaje = `🧾 *Comprobante Electrónico*\n\n`;
    mensaje += `Empresa: *${empresaNombre}*\n`;
    mensaje += `Tipo: ${tipoDocumento}\n`;
    mensaje += `Serie-Número: *${serie}-${String(correlativo).padStart(8, '0')}*\n`;
    mensaje += `Monto: *S/ ${monto.toFixed(2)}*\n\n`;
    mensaje += `📄 *Adjuntos:*\n`;
    mensaje += `- Comprobante PDF\n`;
    if (incluyeXML) {
      mensaje += `- Archivo XML\n`;
      mensaje += `- Constancia SUNAT (CDR)\n`;
    }
    mensaje += `\nGracias por su preferencia. 🙏`;

    return mensaje;
  }

  /**
   * Envía comprobante por WhatsApp
   */
  async enviarComprobante(
    params: EnviarComprobanteParams,
  ): Promise<{ success: boolean; mensajeId?: string; error?: string }> {
    if (!this.isEnabled()) {
      throw new BadRequestException(
        'WhatsApp no está configurado. Contacte al administrador del sistema.',
      );
    }

    const {
      comprobanteId,
      empresaId,
      usuarioId,
      numeroDestino,
      pdfUrl,
      xmlUrl,
      incluyeXML,
    } = params;

    try {
      // Formatear número
      const numeroFormateado = this.formatearNumero(numeroDestino);

      // Generar mensaje base
      let mensaje = this.generarMensaje(params);

      console.log(`[WhatsApp Debug] Intentando enviar a ${numeroFormateado} con PDF: ${pdfUrl}`);

      // Preparar URLs de medios
      const candidatos = [pdfUrl, ...(incluyeXML && xmlUrl ? [xmlUrl] : [])].filter(
        (u): u is string => !!u,
      );

      const mediaUrls = candidatos; // BYPASS PUBLIC FILTER FOR DEBUGGING to see if that's the issue.
      // const esPublica = (u: string) => /^https?:\/\//.test(u); // && !/localhost|127\.0\.0\.1/.test(u);
      // const mediaUrls = candidatos.filter(esPublica);

      console.log(`[WhatsApp Debug] Media URLs filtradas: ${JSON.stringify(mediaUrls)}`);

      if (mediaUrls.length === 0 && candidatos.length > 0) {
        console.warn(`[WhatsApp Warning] Las URLs de medios fueron filtradas o son inválidas. Se enviará como texto.`);
      }

      // Si no hay medios públicos, agregar enlaces al cuerpo del mensaje
      if (mediaUrls.length === 0) {
        mensaje += `\n\nEnlaces de descarga:`;
        if (pdfUrl) mensaje += `\n- PDF: ${pdfUrl}`;
        if (incluyeXML && xmlUrl) mensaje += `\n- XML: ${xmlUrl}`;
      }

      // Construir payload para Twilio: solo incluir mediaUrl si hay válidas
      const payload: any = {
        from: this.whatsappNumber,
        to: numeroFormateado,
        body: mensaje,
      };
      if (mediaUrls.length > 0) {
        payload.mediaUrl = mediaUrls;
      }

      // Enviar mensaje con Twilio
      const messageResponse = await this.twilioClient.messages.create(payload);

      // Registrar envío en BD
      await this.prisma.whatsAppEnvio.create({
        data: {
          comprobanteId,
          empresaId,
          usuarioId,
          numeroDestino: numeroFormateado,
          estado: 'ENVIADO',
          mensajeId: messageResponse.sid,
          costoUSD: 0.02, // Costo estimado por conversación de utilidad
          incluyeXML,
        },
      });

      this.logger.log(
        `✅ WhatsApp enviado: ${messageResponse.sid} a ${numeroFormateado}`,
      );

      return {
        success: true,
        mensajeId: messageResponse.sid,
      };
    } catch (error) {
      this.logger.error(
        `❌ Error enviando WhatsApp: ${error.message}`,
        error.stack,
      );

      // Registrar fallo en BD
      await this.prisma.whatsAppEnvio.create({
        data: {
          comprobanteId,
          empresaId,
          usuarioId,
          numeroDestino,
          estado: 'FALLIDO',
          error: error.message,
          costoUSD: 0,
          incluyeXML,
        },
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Genera el mensaje de WhatsApp para la guía
   */
  private generarMensajeGuia(params: EnviarGuiaParams): string {
    const {
      empresaNombre,
      serie,
      correlativo,
      destinatario,
    } = params;

    let mensaje = `🚚 *Guía de Remisión Electrónica*\n\n`;
    mensaje += `Empresa: *${empresaNombre}*\n`;
    mensaje += `Serie-Número: *${serie}-${String(correlativo).padStart(8, '0')}*\n`;
    mensaje += `Destinatario: ${destinatario}\n\n`;
    mensaje += `📄 *Adjuntos:*\n`;
    mensaje += `- Guía PDF\n`;
    mensaje += `\nGracias por su preferencia. 🙏`;

    return mensaje;
  }

  /**
   * Envía guía de remisión por WhatsApp
   */
  async enviarGuia(
    params: EnviarGuiaParams,
  ): Promise<{ success: boolean; mensajeId?: string; error?: string }> {
    if (!this.isEnabled()) {
      throw new BadRequestException(
        'WhatsApp no está configurado. Contacte al administrador del sistema.',
      );
    }

    const {
      guiaRemisionId,
      empresaId,
      usuarioId,
      numeroDestino,
      pdfUrl,
    } = params;

    try {
      const numeroFormateado = this.formatearNumero(numeroDestino);
      let mensaje = this.generarMensajeGuia(params);
      const mediaUrls = [pdfUrl].filter((u): u is string => !!u);

      if (mediaUrls.length === 0) {
        mensaje += `\n\nEnlace de descarga:\n- PDF: ${pdfUrl}`;
      }

      const payload: any = {
        from: this.whatsappNumber,
        to: numeroFormateado,
        body: mensaje,
      };

      if (mediaUrls.length > 0) {
        payload.mediaUrl = mediaUrls;
      }

      const messageResponse = await this.twilioClient.messages.create(payload);

      await this.prisma.whatsAppEnvio.create({
        data: {
          guiaRemisionId,
          empresaId,
          usuarioId,
          numeroDestino: numeroFormateado,
          estado: 'ENVIADO',
          mensajeId: messageResponse.sid,
          costoUSD: 0.02,
          incluyeXML: false,
        },
      });

      this.logger.log(
        `✅ WhatsApp Guía enviado: ${messageResponse.sid} a ${numeroFormateado}`,
      );

      return {
        success: true,
        mensajeId: messageResponse.sid,
      };
    } catch (error) {
      this.logger.error(
        `❌ Error enviando WhatsApp Guía: ${error.message}`,
        error.stack,
      );

      await this.prisma.whatsAppEnvio.create({
        data: {
          guiaRemisionId,
          empresaId,
          usuarioId,
          numeroDestino,
          estado: 'FALLIDO',
          error: error.message,
          costoUSD: 0,
        },
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Obtiene el historial de envíos de WhatsApp de una empresa
   */
  async obtenerHistorialEmpresa(
    empresaId: number,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;

    const [envios, total] = await Promise.all([
      this.prisma.whatsAppEnvio.findMany({
        where: { empresaId },
        include: {
          comprobante: {
            select: {
              tipoDoc: true,
              serie: true,
              correlativo: true,
              mtoImpVenta: true,
              fechaEmision: true,
              cliente: {
                select: {
                  nombre: true,
                  nroDoc: true,
                  telefono: true,
                },
              },
            },
          },
          usuario: {
            select: {
              nombre: true,
              email: true,
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.whatsAppEnvio.count({ where: { empresaId } }),
    ]);

    return {
      data: envios,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Obtiene estadísticas de uso de WhatsApp para el admin del sistema
   */
  async obtenerEstadisticasGlobales(fechaInicio?: Date, fechaFin?: Date) {
    const where: any = {};

    if (fechaInicio && fechaFin) {
      where.creadoEn = {
        gte: fechaInicio,
        lte: fechaFin,
      };
    }

    const [totalEnvios, enviosPorEstado, costoTotal, enviosPorEmpresa] =
      await Promise.all([
        // Total de envíos
        this.prisma.whatsAppEnvio.count({ where }),

        // Envíos por estado
        this.prisma.whatsAppEnvio.groupBy({
          by: ['estado'],
          where,
          _count: true,
        }),

        // Costo total
        this.prisma.whatsAppEnvio.aggregate({
          where,
          _sum: {
            costoUSD: true,
          },
        }),

        // Top 10 empresas por uso
        this.prisma.whatsAppEnvio.groupBy({
          by: ['empresaId'],
          where,
          _count: true,
          orderBy: {
            _count: {
              empresaId: 'desc',
            },
          },
          take: 10,
        }),
      ]);

    // Obtener nombres de empresas
    const empresaIds = enviosPorEmpresa.map((e) => e.empresaId);
    const empresas = await this.prisma.empresa.findMany({
      where: { id: { in: empresaIds } },
      select: { id: true, razonSocial: true, ruc: true },
    });

    const empresasMap = new Map(empresas.map((e) => [e.id, e]));

    return {
      totalEnvios,
      enviosPorEstado: enviosPorEstado.map((e) => ({
        estado: e.estado,
        cantidad: e._count,
      })),
      costoTotalUSD: Number(costoTotal._sum.costoUSD || 0),
      topEmpresas: enviosPorEmpresa.map((e) => ({
        empresaId: e.empresaId,
        empresa: empresasMap.get(e.empresaId),
        cantidadEnvios: e._count,
      })),
    };
  }

  /**
   * Obtiene el costo total de una empresa en un período
   */
  async obtenerCostoEmpresa(
    empresaId: number,
    fechaInicio: Date,
    fechaFin: Date,
  ) {
    const resultado = await this.prisma.whatsAppEnvio.aggregate({
      where: {
        empresaId,
        creadoEn: {
          gte: fechaInicio,
          lte: fechaFin,
        },
      },
      _sum: {
        costoUSD: true,
      },
      _count: true,
    });

    return {
      empresaId,
      cantidadEnvios: resultado._count,
      costoTotalUSD: Number(resultado._sum.costoUSD || 0),
      periodo: {
        inicio: fechaInicio,
        fin: fechaFin,
      },
    };
  }
}
