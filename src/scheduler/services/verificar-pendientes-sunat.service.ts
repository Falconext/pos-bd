import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { EnviarSunatService } from '../../comprobante/enviar-sunat.service';

@Injectable()
export class VerificarPendientesSunatService {
  private readonly logger = new Logger(VerificarPendientesSunatService.name);
  private readonly documentUrl = 'https://back.apisunat.com/documents';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EnviarSunatService))
    private readonly enviarSunat: EnviarSunatService,
  ) { }

  /**
   * Job 1: Check status of invoices that were received by SUNAT but still processing
   * (have documentoId but status is PENDIENTE)
   */
  async execute(): Promise<void> {
    try {
      const pendientes = await this.prisma.comprobante.findMany({
        where: {
          estadoEnvioSunat: 'PENDIENTE',
          documentoId: { not: null },
        },
        include: {
          empresa: { select: { providerToken: true } },
        },
      });

      this.logger.log(
        `[Job 1] Encontrados ${pendientes.length} comprobantes PENDIENTES con documentoId`,
      );

      for (const comprobante of pendientes) {
        try {
          const statusResponse = await axios.get(
            `${this.documentUrl}/${comprobante.documentoId}/getById?data=true`,
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${comprobante.empresa?.providerToken}`,
              },
            },
          );

          const finalResponse = statusResponse.data;
          const status = finalResponse.status;

          await this.prisma.comprobante.update({
            where: { id: comprobante.id },
            data: {
              estadoEnvioSunat:
                status === 'ACEPTADO'
                  ? 'EMITIDO'
                  : status === 'EXCEPCION'
                    ? 'RECHAZADO'
                    : 'PENDIENTE',
              sunatXml: finalResponse.xml || null,
              sunatCdrZip: finalResponse.cdr || null,
              sunatCdrResponse: JSON.stringify(finalResponse),
              sunatErrorMsg:
                status !== 'ACEPTADO'
                  ? finalResponse.error?.message || 'Error desconocido'
                  : null,
            },
          });

          if (status === 'ACEPTADO' || status === 'RECHAZADO') {
            this.logger.log(
              `Comprobante ${comprobante.id} actualizado a ${status}`,
            );
          }
        } catch (err: any) {
          this.logger.error(
            `Error verificando documento ${comprobante.documentoId}: ${err.message}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Error en verificación de SUNAT: ${err.message}`);
    }
  }

  /**
   * Job 2: Retry failed submissions that never reached SUNAT
   * (estadoEnvioSunat = FALLIDO_ENVIO and sunatNextRetryAt <= now)
   */
  async reintentarEnviosFallidos(): Promise<void> {
    try {
      const fallidos = await this.prisma.comprobante.findMany({
        where: {
          estadoEnvioSunat: 'FALLIDO_ENVIO',
          sunatNextRetryAt: { lte: new Date() },
        },
        take: 10, // Process max 10 at a time to avoid overload
        orderBy: { sunatNextRetryAt: 'asc' },
      });

      this.logger.log(
        `[Job 2] Encontrados ${fallidos.length} comprobantes FALLIDO_ENVIO listos para reintentar`,
      );

      for (const comprobante of fallidos) {
        try {
          this.logger.log(
            `🔄 Reintentando envío de comprobante ${comprobante.id} (intento #${(comprobante.sunatRetriesCount || 0) + 1})`,
          );

          await this.enviarSunat.execute(comprobante.id);

          this.logger.log(`✅ Comprobante ${comprobante.id} enviado exitosamente en reintento`);
        } catch (err: any) {
          // The enviarSunat.execute already handles updating the state
          // Just log the error here
          this.logger.warn(
            `⚠️ Reintento de comprobante ${comprobante.id} falló: ${err.message}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Error en reintentos de SUNAT: ${err.message}`);
    }
  }
}
