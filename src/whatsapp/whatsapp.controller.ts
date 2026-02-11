import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppController {
  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly prisma: PrismaService,
  ) { }

  /**
   * Enviar comprobante por WhatsApp
   * POST /whatsapp/enviar/:comprobanteId
   */
  @Post('enviar/:comprobanteId')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async enviarComprobante(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() body: { numeroDestino: string; incluyeXML?: boolean },
    @User() user: any,
  ) {
    const { numeroDestino, incluyeXML = false } = body;

    if (!numeroDestino) {
      throw new BadRequestException('El número de destino es requerido');
    }

    // Verificar que el comprobante existe y pertenece a la empresa del usuario
    const comprobante = await this.prisma.comprobante.findFirst({
      where: {
        id: comprobanteId,
        empresaId: user.empresaId,
      },
      select: {
        id: true,
        tipoDoc: true,
        serie: true,
        correlativo: true,
        mtoImpVenta: true,
        sunatXml: true,
        s3PdfUrl: true,
        s3XmlUrl: true,
        s3CdrUrl: true,
        empresa: {
          select: {
            razonSocial: true,
            nombreComercial: true,
          },
        },
        cliente: {
          select: {
            nombre: true,
            nroDoc: true,
            telefono: true,
          },
        },
      },
    });

    if (!comprobante) {
      throw new BadRequestException(
        'Comprobante no encontrado o no pertenece a su empresa',
      );
    }

    // Verificar que el comprobante tiene PDF generado
    if (!comprobante.sunatXml && !comprobante.s3PdfUrl) {
      throw new BadRequestException(
        'El comprobante no tiene PDF generado. Genere el PDF primero.',
      );
    }

    // Preferir URLs de S3 (públicas) sobre URLs locales o de SUNAT
    const baseUrl = process.env.BACKEND_URL || 'http://localhost:4000';
    const pdfUrl = comprobante.s3PdfUrl || `${baseUrl}/comprobante/pdf/${comprobanteId}`;
    const xmlUrl = incluyeXML
      ? (comprobante.s3XmlUrl || comprobante.sunatXml || `${baseUrl}/comprobante/xml/${comprobanteId}`)
      : undefined;

    // Enviar por WhatsApp
    const resultado = await this.whatsappService.enviarComprobante({
      comprobanteId,
      empresaId: user.empresaId,
      usuarioId: user.id,
      numeroDestino,
      pdfUrl,
      xmlUrl,
      incluyeXML,
      empresaNombre:
        comprobante.empresa.nombreComercial ||
        comprobante.empresa.razonSocial,
      tipoDoc: comprobante.tipoDoc,
      serie: comprobante.serie,
      correlativo: comprobante.correlativo,
      monto: comprobante.mtoImpVenta,
    });

    return {
      code: resultado.success ? 200 : 400,
      message: resultado.success
        ? 'Comprobante enviado por WhatsApp exitosamente'
        : 'Error al enviar comprobante por WhatsApp',
      data: resultado,
    };
  }

  /**
   * Enviar guía por WhatsApp
   * POST /whatsapp/enviar-guia/:guiaId
   */
  @Post('enviar-guia/:guiaId')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async enviarGuia(
    @Param('guiaId', ParseIntPipe) guiaId: number,
    @Body() body: { numeroDestino: string },
    @User() user: any,
  ) {
    const { numeroDestino } = body;

    if (!numeroDestino) {
      throw new BadRequestException('El número de destino es requerido');
    }

    const guia = await this.prisma.guiaRemision.findFirst({
      where: {
        id: guiaId,
        empresaId: user.empresaId,
      },
      select: {
        id: true,
        serie: true,
        correlativo: true,
        s3PdfUrl: true,
        empresa: {
          select: {
            razonSocial: true,
            nombreComercial: true,
          },
        },
        destinatarioRazonSocial: true,
      },
    });

    if (!guia) {
      throw new BadRequestException(
        'Guía no encontrada o no pertenece a su empresa',
      );
    }

    const baseUrl = process.env.BACKEND_URL || 'http://localhost:4000';
    const pdfUrl = guia.s3PdfUrl || `${baseUrl}/guia-remision/${guiaId}/pdf`;

    const resultado = await this.whatsappService.enviarGuia({
      guiaRemisionId: guiaId,
      empresaId: user.empresaId,
      usuarioId: user.id,
      numeroDestino,
      pdfUrl,
      empresaNombre:
        guia.empresa.nombreComercial || guia.empresa.razonSocial,
      serie: guia.serie,
      correlativo: guia.correlativo,
      destinatario: guia.destinatarioRazonSocial,
    });

    return {
      code: resultado.success ? 200 : 400,
      message: resultado.success
        ? 'Guía enviada por WhatsApp exitosamente'
        : 'Error al enviar guía por WhatsApp',
      data: resultado,
    };
  }

  /**
   * Obtener historial de envíos de la empresa
   * GET /whatsapp/historial
   */
  @Get('historial')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerHistorial(
    @User() user: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    const resultado = await this.whatsappService.obtenerHistorialEmpresa(
      user.empresaId,
      pageNum,
      limitNum,
    );

    return {
      code: 200,
      message: 'Historial de envíos obtenido exitosamente',
      data: resultado,
    };
  }

  /**
   * Obtener costo de la empresa en un período
   * GET /whatsapp/costo
   */
  @Get('costo')
  @Roles('ADMIN_EMPRESA')
  async obtenerCosto(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    const inicio = fechaInicio
      ? new Date(fechaInicio)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const fin = fechaFin ? new Date(fechaFin) : new Date();

    const resultado = await this.whatsappService.obtenerCostoEmpresa(
      user.empresaId,
      inicio,
      fin,
    );

    return {
      code: 200,
      message: 'Costo de WhatsApp obtenido exitosamente',
      data: resultado,
    };
  }

  /**
   * Obtener estadísticas globales (solo ADMIN_SISTEMA)
   * GET /whatsapp/estadisticas
   */
  @Get('estadisticas')
  @Roles('ADMIN_SISTEMA')
  async obtenerEstadisticas(
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    const inicio = fechaInicio ? new Date(fechaInicio) : undefined;
    const fin = fechaFin ? new Date(fechaFin) : undefined;

    const resultado =
      await this.whatsappService.obtenerEstadisticasGlobales(inicio, fin);

    return {
      code: 200,
      message: 'Estadísticas globales obtenidas exitosamente',
      data: resultado,
    };
  }

  /**
   * Verificar si WhatsApp está habilitado
   * GET /whatsapp/status
   */
  @Get('status')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA', 'ADMIN_SISTEMA')
  async verificarEstado() {
    const habilitado = this.whatsappService.isEnabled();

    return {
      code: 200,
      message: habilitado
        ? 'WhatsApp está habilitado'
        : 'WhatsApp no está configurado',
      data: {
        habilitado,
      },
    };
  }
}
