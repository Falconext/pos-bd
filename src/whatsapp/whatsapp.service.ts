import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

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

interface WhatsAppCredentials {
  token: string;
  phoneId: string;
  source: 'PLATFORM' | 'EMPRESA';
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly apiUrl = 'https://graph.facebook.com/v21.0';

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const { token, phoneId } = this.getCredentials();

    if (!token || !phoneId) {
      this.logger.warn(
        '⚠️  Credenciales de WhatsApp Cloud API no configuradas.',
      );
    } else {
      this.logger.log('✅ WhatsApp Cloud API inicializado correctamente');
    }
  }

  private getCredentials(): { token: string; phoneId: string } {
    const token =
      this.configService.get<string>('WHATSAPP_TOKEN') ||
      this.configService.get<string>('META_WHATSAPP_TOKEN') ||
      '';
    const phoneId =
      this.configService.get<string>('WHATSAPP_PHONE_ID') ||
      this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID') ||
      this.configService.get<string>('META_WHATSAPP_PHONE_ID') ||
      '';

    return { token, phoneId };
  }

  private async getCredentialsForEmpresa(
    empresaId: number,
  ): Promise<WhatsAppCredentials> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        whatsappProvider: true,
        whatsappApiToken: true,
        whatsappPhoneNumberId: true,
        whatsappActivo: true,
      },
    });

    if (!empresa?.whatsappActivo || empresa?.whatsappProvider === 'DISABLED') {
      throw new BadRequestException(
        'WhatsApp está deshabilitado para esta empresa.',
      );
    }

    if (empresa.whatsappProvider === 'EMPRESA') {
      if (!empresa.whatsappApiToken || !empresa.whatsappPhoneNumberId) {
        throw new BadRequestException(
          'WhatsApp propio no configurado. Agrega token y phone number ID de Meta para esta empresa.',
        );
      }

      return {
        token: empresa.whatsappApiToken,
        phoneId: empresa.whatsappPhoneNumberId,
        source: 'EMPRESA',
      };
    }

    const platform = this.getCredentials();
    if (!platform.token || !platform.phoneId) {
      throw new BadRequestException(
        'WhatsApp de plataforma no está configurado.',
      );
    }

    return { ...platform, source: 'PLATFORM' };
  }

  /**
   * Verifica si WhatsApp está habilitado
   */
  isEnabled(): boolean {
    const { token, phoneId } = this.getCredentials();
    return !!token && !!phoneId;
  }

  /**
   * Formatea número al formato internacional de Meta (ej: 519XXXXXXXX)
   */
  private formatearNumero(numero: string): string {
    let num = numero.replace(/\D/g, '');

    // Si tiene 9 dígitos, asumir Perú (+51)
    if (num.length === 9) {
      num = '51' + num;
    }

    return num;
  }

  /**
   * Envía un mensaje de texto libre (requiere ventana activa de 24h o template aprobado)
   */
  async enviarTexto(
    numero: string,
    mensaje: string,
  ): Promise<{ success: boolean; error?: string }> {
    const { token, phoneId } = this.getCredentials();
    if (!token || !phoneId)
      return { success: false, error: 'WhatsApp no configurado' };

    const to = this.formatearNumero(numero);
    try {
      await axios.post(
        `${this.apiUrl}/${phoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: mensaje },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return { success: true };
    } catch (error) {
      const msg = error.response?.data?.error?.message || error.message;
      this.logger.warn(`WhatsApp texto fallido a ${to}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Envía comprobante por WhatsApp usando Meta Cloud API
   */
  async enviarComprobante(
    params: EnviarComprobanteParams,
  ): Promise<{ success: boolean; mensajeId?: string; error?: string }> {
    const {
      comprobanteId,
      empresaId,
      usuarioId,
      numeroDestino,
      pdfUrl,
      empresaNombre,
      tipoDoc,
      serie,
      correlativo,
      monto,
      incluyeXML,
    } = params;

    try {
      const { token, phoneId, source } =
        await this.getCredentialsForEmpresa(empresaId);
      const to = this.formatearNumero(numeroDestino);

      const tipoDocumento =
        tipoDoc === '01'
          ? 'Factura'
          : tipoDoc === '03'
            ? 'Boleta'
            : 'Comprobante';
      const correlativoStr = `${serie}-${String(correlativo).padStart(8, '0')}`;
      const mensaje = `🧾 *${empresaNombre}*\nAdjuntamos tu ${tipoDocumento} ${correlativoStr} por el monto de S/ ${monto.toFixed(2)}.\n\nGracias por tu preferencia.`;

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'document',
        document: {
          link: pdfUrl,
          caption: mensaje,
          filename: `${correlativoStr}.pdf`,
        },
      };

      const response = await axios.post(
        `${this.apiUrl}/${phoneId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const mensajeId = response.data.messages[0].id;

      // Registrar envío en BD
      await this.prisma.whatsAppEnvio.create({
        data: {
          comprobanteId,
          empresaId,
          usuarioId,
          numeroDestino: to,
          estado: 'ENVIADO',
          mensajeId,
          costoUSD: 0.01,
          incluyeXML,
        },
      });

      this.logger.log(`✅ WhatsApp enviado (Meta): ${mensajeId} a ${to}`);
      this.logger.log(`📲 WhatsApp source: ${source} empresaId=${empresaId}`);

      return { success: true, mensajeId };
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      this.logger.error(`❌ Error enviando WhatsApp (Meta): ${errorMsg}`);

      await this.prisma.whatsAppEnvio.create({
        data: {
          comprobanteId,
          empresaId,
          usuarioId,
          numeroDestino,
          estado: 'FALLIDO',
          error: errorMsg,
          incluyeXML,
        },
      });

      return { success: false, error: errorMsg };
    }
  }

  /**
   * Envía guía de remisión por WhatsApp
   */
  async enviarGuia(
    params: EnviarGuiaParams,
  ): Promise<{ success: boolean; mensajeId?: string; error?: string }> {
    const { guiaRemisionId, empresaId, usuarioId, numeroDestino, pdfUrl } =
      params;

    try {
      const { token, phoneId } = await this.getCredentialsForEmpresa(empresaId);
      const to = this.formatearNumero(numeroDestino);

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: 'hello_world',
          language: { code: 'en_US' },
        },
      };

      const response = await axios.post(
        `${this.apiUrl}/${phoneId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const mensajeId = response.data.messages[0].id;

      await this.prisma.whatsAppEnvio.create({
        data: {
          guiaRemisionId,
          empresaId,
          usuarioId,
          numeroDestino: to,
          estado: 'ENVIADO',
          mensajeId,
          costoUSD: 0.01,
        },
      });

      return { success: true, mensajeId };
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      this.logger.error(`❌ Error WhatsApp Guía: ${errorMsg}`);

      await this.prisma.whatsAppEnvio.create({
        data: {
          guiaRemisionId,
          empresaId,
          usuarioId,
          numeroDestino,
          estado: 'FALLIDO',
          error: errorMsg,
        },
      });

      return { success: false, error: errorMsg };
    }
  }

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
              cliente: true,
            },
          },
          usuario: { select: { nombre: true } },
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

  /**
   * Obtiene estadísticas globales (solo ADMIN_SISTEMA)
   */
  async obtenerEstadisticasGlobales(fechaInicio?: Date, fechaFin?: Date) {
    const where: any = {};
    if (fechaInicio && fechaFin) {
      where.creadoEn = { gte: fechaInicio, lte: fechaFin };
    }

    const [totalEnvios, enviosPorEstado, costoTotal, enviosPorEmpresa] =
      await Promise.all([
        this.prisma.whatsAppEnvio.count({ where }),
        this.prisma.whatsAppEnvio.groupBy({
          by: ['estado'],
          where,
          _count: true,
        }),
        this.prisma.whatsAppEnvio.aggregate({
          where,
          _sum: { costoUSD: true },
        }),
        this.prisma.whatsAppEnvio.groupBy({
          by: ['empresaId'],
          where,
          _count: true,
          orderBy: { _count: { empresaId: 'desc' } },
          take: 10,
        }),
      ]);

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
}
