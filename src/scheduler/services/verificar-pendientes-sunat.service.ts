import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EnviarSunatService, SunatPayloadException, isSunatAlreadyRegisteredError } from '../../comprobante/enviar-sunat.service';
import { ComprobanteService } from '../../comprobante/comprobante.service';
import { GuiaRemisionService } from '../../guia-remision/guia-remision.service';
import { QpseClient, QpseSendResponse } from '../../common/utils/qpse.client';
import { S3Service } from '../../s3/s3.service';
import { isQpseProvider, resolveBillingProvider } from '../../common/utils/billing-provider';
import { NotificacionesService } from '../../notificaciones/notificaciones.service';

const MAX_RETRIES_ANTES_NOTIFICAR = 5;
const PENDIENTE_STUCK_HORAS = 2;

@Injectable()
export class VerificarPendientesSunatService {
  private readonly logger = new Logger(VerificarPendientesSunatService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EnviarSunatService))
    private readonly enviarSunat: EnviarSunatService,
    @Inject(forwardRef(() => ComprobanteService))
    private readonly comprobanteService: ComprobanteService,
    @Inject(forwardRef(() => GuiaRemisionService))
    private readonly guiaRemisionService: GuiaRemisionService,
    private readonly qpseClient: QpseClient,
    private readonly s3Service: S3Service,
    private readonly notificacionesService: NotificacionesService,
  ) { }

  /**
   * Job 3: Retry failed Guías Remisión (estadoSunat = FALLIDO_ENVIO and sunatNextRetryAt <= now)
   */
  async reintentarGuiasFallidas(): Promise<void> {
    try {
      const fallidas = await this.prisma.guiaRemision.findMany({
        where: {
          estadoSunat: 'FALLIDO_ENVIO',
          sunatNextRetryAt: { lte: new Date() },
        },
        take: 10,
        orderBy: { sunatNextRetryAt: 'asc' },
      });

      if (fallidas.length > 0) {
        this.logger.log(`[Job 3] Reintentando ${fallidas.length} guías FALLIDO_ENVIO`);
      }

      for (const guia of fallidas) {
        try {
          this.logger.log(`🔄 Reintentando guía ${guia.id} (${guia.serie}-${guia.correlativo})`);
          await this.guiaRemisionService.enviarSunat(guia.id, guia.empresaId);
        } catch (err: any) {
          this.logger.warn(`⚠️ Reintento de guía ${guia.id} falló: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Error en reintentos de Guías: ${err.message}`);
    }
  }

  /**
   * Job 1: Check status of invoices that were received by SUNAT but still processing
   * (have documentoId but status is PENDIENTE)
   */
  async execute(): Promise<void> {
    try {
      const pendientes = await (this.prisma.comprobante as any).findMany({
        where: {
          estadoEnvioSunat: 'PENDIENTE',
          documentoId: { not: null },
          OR: [
            { sunatNextRetryAt: null },
            { sunatNextRetryAt: { lte: new Date() } },
          ],
        },
        include: {
          empresa: {
            select: {
              usuarioPse: true,
              contrasenaPse: true,
              billingProvider: true,
              usaDemo: true,
            },
          },
        },
      }) as (any & {
        empresa: {
          usuarioPse: string | null;
          contrasenaPse: string | null;
          billingProvider: string | null;
          usaDemo: boolean;
        } | null
      })[];

      this.logger.log(
        `[Job 1] Encontrados ${pendientes.length} comprobantes PENDIENTES con documentoId`,
      );

      // Tipos síncronos (Boleta y sus notas): QPSE no soporta consultarTicket,
      // hay que re-enviar el comprobante completo.
      const TIPOS_SINCRONOS = ['03', '07', '08'];

      for (const comprobante of pendientes) {
        try {
          const billingProvider = resolveBillingProvider(comprobante.empresa);

          if (!isQpseProvider(billingProvider)) {
            this.logger.log(
              `[Job 1] Proveedor ${billingProvider} en comprobante ${comprobante.id} → revalidando con flujo principal`,
            );
            await this.enviarSunat.execute(comprobante.id);
            continue;
          }

          const qpseUsername = comprobante.empresa?.usuarioPse;
          const qpsePassword = comprobante.empresa?.contrasenaPse;
          if (!qpseUsername || !qpsePassword) {
            this.logger.warn(`Comprobante ${comprobante.id} sin credenciales QPSE configuradas`);
            continue;
          }

          if (TIPOS_SINCRONOS.includes(comprobante.tipoDoc)) {
            this.logger.log(
              `[Job 1] Boleta/sincrono ${comprobante.id} (tipoDoc ${comprobante.tipoDoc}) → re-enviando`,
            );
            try {
              await this.enviarSunat.execute(comprobante.id);
            } catch (err: any) {
              if (err instanceof SunatPayloadException) {
                this.logger.warn(`[Job 1] Comprobante ${comprobante.id} → error fatal SUNAT, auto-eliminando: ${err.message}`);
                await this.autoEliminarComprobante(comprobante.id, err.message);
                continue;
              }
              const msg = String(err?.message || '').toLowerCase();
              if (isSunatAlreadyRegisteredError(err?.response?.data) || isSunatAlreadyRegisteredError(msg)) {
                this.logger.warn(`[Job 1] Comprobante ${comprobante.id} ya registrado en SUNAT → requiere conciliación`);
                await this.prisma.comprobante.update({
                  where: { id: comprobante.id },
                  data: {
                    estadoEnvioSunat: 'PENDIENTE_CONCILIACION' as any,
                    sunatNextRetryAt: null,
                    sunatErrorMsg: err?.message || 'SUNAT 1033: comprobante registrado previamente; requiere conciliación.',
                  },
                });
              } else {
                throw err;
              }
            }
            continue;
          }

          const qpseAccess = await this.qpseClient.obtenerTokenAcceso({
            username: qpseUsername,
            password: qpsePassword,
          });

          let finalResponse: QpseSendResponse;
          try {
            finalResponse = await this.qpseClient.consultarTicket(
              comprobante.documentoId!,
              qpseAccess.token_acceso!,
            );
          } catch (ticketErr: any) {
            const errMsg = String(ticketErr?.message || '').toLowerCase();
            // QPSE synchronous documents: CDR was in the original send response — re-evaluate it
            if (errMsg.includes('no aplica') || errMsg.includes('use la respuesta')) {
              this.logger.warn(
                `[Job 1] consultarTicket no aplica para ${comprobante.id} → re-evaluando sunatCdrResponse almacenado`,
              );
              const stored = comprobante.sunatCdrResponse
                ? (() => { try { return JSON.parse(comprobante.sunatCdrResponse as string); } catch { return null; } })()
                : null;
              if (!stored) {
                this.logger.warn(`[Job 1] Sin sunatCdrResponse para ${comprobante.id}, no se puede resolver`);
                continue;
              }
              finalResponse = stored as QpseSendResponse;
            } else {
              throw ticketErr;
            }
          }
          const status = this.normalizeQpseStatus(finalResponse);
          const storageUpdate = await this.persistQpseAssets(comprobante, finalResponse);

          await this.prisma.comprobante.update({
            where: { id: comprobante.id },
            data: {
              estadoEnvioSunat:
                status === 'ACEPTADO'
                  ? 'EMITIDO'
                  : status === 'RECHAZADO'
                    ? 'RECHAZADO'
                    : 'PENDIENTE',
              sunatCdrZip: finalResponse.cdr || null,
              sunatCdrResponse: JSON.stringify(finalResponse),
              sunatErrorMsg:
                status !== 'ACEPTADO'
                  ? this.extractQpseMessage(finalResponse)
                  : null,
              // Limpiar contadores de backoff cuando se resuelve exitosamente
              ...(status !== 'PENDIENTE' && { sunatNextRetryAt: null }),
              ...storageUpdate,
            },
          });

          // Si fue ACEPTADO, generar y subir el PDF
          if (status === 'ACEPTADO') {
            try {
              await this.enviarSunat.generarYSubirPDF(comprobante.id);
              this.logger.log(`📄 PDF generado para comprobante ${comprobante.id}`);
            } catch (pdfErr: any) {
              this.logger.warn(`⚠️ Error generando PDF para ${comprobante.id}: ${pdfErr.message}`);
            }
          }

          if (status === 'ACEPTADO' || status === 'RECHAZADO') {
            this.logger.log(
              `Comprobante ${comprobante.id} actualizado a ${status}`,
            );
          }

          // Notificar al admin si SUNAT rechazó el comprobante
          if (status === 'RECHAZADO') {
            const errorMsg = this.extractQpseMessage(finalResponse);
            const ref = `${comprobante.serie ?? ''}-${String(comprobante.correlativo ?? '').padStart(8, '0')}`;
            await this.notificacionesService.notificarFallaSunat({
              empresaId: comprobante.empresaId,
              tipo: 'CRITICAL',
              titulo: 'Comprobante rechazado por SUNAT',
              mensaje: `${ref} fue rechazado: ${errorMsg}. Revísalo y corrígelo.`,
              meta: {
                comprobanteId: comprobante.id,
                serie: comprobante.serie,
                correlativo: comprobante.correlativo,
                tipoDoc: comprobante.tipoDoc,
                errorMsg,
              },
            }).catch(() => { /* no bloquear el flujo */ });
          }
        } catch (err: any) {
          this.logger.error(
            `Error verificando documento ${comprobante.documentoId}: ${err.message}`,
          );
          // Aplicar backoff para no reintentar inmediatamente en el próximo tick del scheduler.
          // Esto evita saturar SUNAT cuando está caída.
          try {
            const newCount = (comprobante.sunatRetriesCount || 0) + 1;
            const nextRetry = this.enviarSunat.calculateNetworkRetry(newCount);
            await this.prisma.comprobante.update({
              where: { id: comprobante.id },
              data: {
                sunatRetriesCount: newCount,
                sunatLastRetryAt: new Date(),
                sunatNextRetryAt: nextRetry,
                sunatErrorMsg: `[RED] Consulta fallida (intento ${newCount}): ${err.message}`,
              },
            });
          } catch (dbErr: any) {
            this.logger.warn(`No se pudo guardar backoff para ${comprobante.id}: ${dbErr.message}`);
          }
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
          if (err instanceof SunatPayloadException) {
            this.logger.warn(`[Job 2] Comprobante ${comprobante.id} → error fatal SUNAT, auto-eliminando: ${err.message}`);
            await this.autoEliminarComprobante(comprobante.id, err.message);
            continue;
          }
          // The enviarSunat.execute already handles updating the state
          this.logger.warn(
            `⚠️ Reintento de comprobante ${comprobante.id} falló: ${err.message}`,
          );

          // Notificar al admin cuando se agotan los reintentos
          const retriesCount = (comprobante.sunatRetriesCount || 0) + 1;
          if (retriesCount >= MAX_RETRIES_ANTES_NOTIFICAR) {
            const ref = `${comprobante.serie ?? ''}-${String(comprobante.correlativo ?? '').padStart(8, '0')}`;
            await this.notificacionesService.notificarFallaSunat({
              empresaId: comprobante.empresaId,
              tipo: 'WARNING',
              titulo: 'Comprobante pendiente de envío a SUNAT',
              mensaje: `${ref} no pudo enviarse a SUNAT tras ${retriesCount} intentos. Verifica tu conexión y credenciales PSE.`,
              meta: {
                comprobanteId: comprobante.id,
                serie: comprobante.serie,
                correlativo: comprobante.correlativo,
                tipoDoc: comprobante.tipoDoc,
                errorMsg: err.message,
              },
            }).catch(() => { /* no bloquear el flujo */ });
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Error en reintentos de SUNAT: ${err.message}`);
    }
  }

  /**
   * Job 4: Notificar comprobantes PENDIENTE estancados por más de N horas.
   */
  async notificarPendientesEstancados(): Promise<void> {
    try {
      const limite = new Date(Date.now() - PENDIENTE_STUCK_HORAS * 60 * 60 * 1000);
      const estancados = await this.prisma.comprobante.findMany({
        where: {
          estadoEnvioSunat: 'PENDIENTE',
          documentoId: { not: null },
          creadoEn: { lte: limite },
        },
        select: {
          id: true, empresaId: true, serie: true, correlativo: true, tipoDoc: true, creadoEn: true,
        },
        take: 20,
        orderBy: { creadoEn: 'asc' },
      });

      if (estancados.length > 0) {
        this.logger.log(`[Job 4] ${estancados.length} comprobantes PENDIENTE estancados > ${PENDIENTE_STUCK_HORAS}h`);
      }

      for (const comp of estancados) {
        const ref = `${comp.serie ?? ''}-${String(comp.correlativo ?? '').padStart(8, '0')}`;
        const horasEstancado = Math.floor((Date.now() - comp.creadoEn.getTime()) / (60 * 60 * 1000));
        await this.notificacionesService.notificarFallaSunat({
          empresaId: comp.empresaId,
          tipo: 'INFO',
          titulo: 'Comprobante pendiente en SUNAT',
          mensaje: `${ref} lleva más de ${horasEstancado} horas en estado pendiente. SUNAT podría estar procesando la respuesta.`,
          meta: {
            comprobanteId: comp.id,
            serie: comp.serie,
            correlativo: comp.correlativo,
            tipoDoc: comp.tipoDoc,
          },
        }).catch(() => { /* no bloquear el flujo */ });
      }
    } catch (err: any) {
      this.logger.error(`Error en notificaciones de pendientes estancados: ${err.message}`);
    }
  }

  private normalizeQpseStatus(response: QpseSendResponse | null | undefined): 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO' {
    const stateLabel = String(response?.state_label || '').toLowerCase();
    const code = String(response?.code ?? '');

    if (response?.sunat_success === true || stateLabel === 'aceptado' || stateLabel === 'observado' || code === '0') {
      return 'ACEPTADO';
    }

    if (
      stateLabel === 'pendiente' ||
      stateLabel === 'en_proceso' ||
      stateLabel === 'indeterminado' ||
      code === '98'
    ) {
      return 'PENDIENTE';
    }

    return 'RECHAZADO';
  }

  private extractQpseMessage(response: QpseSendResponse | null | undefined): string {
    return (
      response?.message ||
      response?.mensaje ||
      response?.errors?.join(' | ') ||
      response?.errores?.join(' | ') ||
      response?.notes?.join(' | ') ||
      response?.observaciones?.join(' | ') ||
      'Error desconocido'
    );
  }

  private async persistQpseAssets(comprobante: any, response: QpseSendResponse) {
    if (!this.s3Service.isEnabled()) {
      return {};
    }

    const updates: Record<string, string> = {};
    const correlativo = Number(comprobante.correlativo);

    try {
      if (!comprobante.s3XmlUrl && comprobante.sunatXml) {
        const xmlKey = this.s3Service.generateComprobanteKey(
          comprobante.empresaId,
          comprobante.tipoDoc,
          comprobante.serie,
          correlativo,
          'xml',
        );
        updates.s3XmlUrl = await this.s3Service.uploadXML(
          Buffer.from(comprobante.sunatXml, 'utf8'),
          xmlKey,
        );
      }

      if (!comprobante.s3CdrUrl && response?.cdr) {
        const cdrBuffer = Buffer.from(response.cdr, 'base64');
        const tipo =
          comprobante.tipoDoc === '01'
            ? 'factura'
            : comprobante.tipoDoc === '03'
              ? 'boleta'
              : 'nota';
        const numero = String(correlativo).padStart(8, '0');
        const isXml = cdrBuffer.toString('utf8').trim().startsWith('<');
        const cdrKey = `comprobantes/empresa-${comprobante.empresaId}/${tipo}/${comprobante.serie}-${numero}-cdr.${isXml ? 'xml' : 'zip'}`;

        updates.s3CdrUrl = isXml
          ? await this.s3Service.uploadXML(cdrBuffer, cdrKey)
          : await this.s3Service.uploadZIP(cdrBuffer, cdrKey);
      }
    } catch (error: any) {
      this.logger.warn(`No se pudieron persistir assets SUNAT para ${comprobante.id}: ${error.message}`);
    }

    return updates;
  }

  /** Elimina un comprobante con error fatal SUNAT, guarda log y respeta orden de FKs. */
  private async autoEliminarComprobante(id: number, errorMsg?: string): Promise<void> {
    try {
      // Obtener datos del comprobante para el log antes de borrarlo
      const comp = await this.prisma.comprobante.findUnique({
        where: { id },
        select: { id: true, empresaId: true, serie: true, correlativo: true, tipoDoc: true, sunatErrorMsg: true },
      });

      if (comp) {
        await this.comprobanteService.guardarLogErrorFatal({
          empresaId: comp.empresaId,
          serie: comp.serie,
          correlativo: comp.correlativo,
          tipoDoc: comp.tipoDoc,
          errorMsg: errorMsg ?? comp.sunatErrorMsg ?? 'Error fatal SUNAT (scheduler)',
        });
      }

      await this.prisma.$transaction(async (tx) => {
        const movimientos = await tx.movimientoKardex.findMany({
          where: { comprobanteId: id },
          select: { id: true },
        });
        if (movimientos.length) {
          const movIds = movimientos.map((m) => m.id);
          await tx.movimientoKardexLote.deleteMany({ where: { movimientoId: { in: movIds } } });
          await tx.movimientoKardex.deleteMany({ where: { id: { in: movIds } } });
        }
        await tx.detalleComprobante.deleteMany({ where: { comprobanteId: id } });
        await tx.leyenda.deleteMany({ where: { comprobanteId: id } });
        await tx.comprobante.delete({ where: { id } });
      });
      this.logger.log(`🗑️ Comprobante ${id} eliminado automáticamente (error SUNAT fatal)`);
    } catch (err: any) {
      this.logger.error(`Error al auto-eliminar comprobante ${id}: ${err.message}`);
    }
  }
}
