import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EnviarSunatService,
  SunatPayloadException,
  isSunatAlreadyRegisteredError,
} from '../../comprobante/enviar-sunat.service';
import { ComprobanteService } from '../../comprobante/comprobante.service';
import { GuiaRemisionService } from '../../guia-remision/guia-remision.service';
import { QpseClient, QpseSendResponse } from '../../common/utils/qpse.client';
import { S3Service } from '../../s3/s3.service';
import {
  isQpseProvider,
  resolveBillingProvider,
} from '../../common/utils/billing-provider';
import { NotificacionesService } from '../../notificaciones/notificaciones.service';

const MAX_RETRIES_ANTES_NOTIFICAR = 5;
const PENDIENTE_STUCK_HORAS = 2;
/**
 * A partir de esta antigüedad, un comprobante PENDIENTE deja de reenviarse a
 * ciegas y primero se le pregunta a SUNAT (Consulta de Validez) si ya lo tiene
 * registrado. Una hora es holgado: SUNAT responde los tipos síncronos en
 * segundos, así que pasada una hora sin CDR lo más probable es que la respuesta
 * se haya perdido, no que siga procesándose.
 */
const PENDIENTE_AUTOVERIFICAR_HORAS = 1;

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
  ) {}

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
        this.logger.log(
          `[Job 3] Reintentando ${fallidas.length} guías FALLIDO_ENVIO`,
        );
      }

      for (const guia of fallidas) {
        try {
          this.logger.log(
            `🔄 Reintentando guía ${guia.id} (${guia.serie}-${guia.correlativo})`,
          );
          await this.guiaRemisionService.enviarSunat(guia.id, guia.empresaId);
        } catch (err: any) {
          this.logger.warn(
            `⚠️ Reintento de guía ${guia.id} falló: ${err.message}`,
          );
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
      const pendientes = (await (this.prisma.comprobante as any).findMany({
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
      })) as (any & {
        empresa: {
          usuarioPse: string | null;
          contrasenaPse: string | null;
          billingProvider: string | null;
          usaDemo: boolean;
        } | null;
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
            this.logger.warn(
              `Comprobante ${comprobante.id} sin credenciales QPSE configuradas`,
            );
            continue;
          }

          if (TIPOS_SINCRONOS.includes(comprobante.tipoDoc)) {
            // Para estos tipos QPSE no permite reconsultar el CDR, así que el
            // único reintento posible es reenviar el comprobante completo. Pero
            // reenviar uno que SUNAT YA aceptó solo produce un 1033 y lo manda a
            // conciliación manual, y si QPSE sigue devolviendo una respuesta
            // ambigua el comprobante se queda "En procesamiento" para siempre.
            // Por eso, pasado un rato, primero se le pregunta a SUNAT.
            if (await this.resolverPorConsultaValidez(comprobante)) continue;

            this.logger.log(
              `[Job 1] Boleta/sincrono ${comprobante.id} (tipoDoc ${comprobante.tipoDoc}) → re-enviando`,
            );
            try {
              await this.enviarSunat.execute(comprobante.id);
            } catch (err: any) {
              if (err instanceof SunatPayloadException) {
                this.logger.warn(
                  `[Job 1] Comprobante ${comprobante.id} → error fatal SUNAT, auto-eliminando: ${err.message}`,
                );
                await this.autoEliminarComprobante(comprobante.id, err.message);
                continue;
              }
              const msg = String(err?.message || '').toLowerCase();
              if (
                isSunatAlreadyRegisteredError(err?.response?.data) ||
                isSunatAlreadyRegisteredError(msg)
              ) {
                this.logger.warn(
                  `[Job 1] Comprobante ${comprobante.id} ya registrado en SUNAT → requiere conciliación`,
                );
                await this.prisma.comprobante.update({
                  where: { id: comprobante.id },
                  data: {
                    estadoEnvioSunat: 'PENDIENTE_CONCILIACION' as any,
                    sunatNextRetryAt: null,
                    sunatErrorMsg:
                      err?.message ||
                      'SUNAT 1033: comprobante registrado previamente; requiere conciliación.',
                  },
                });
                // SUNAT ya tiene el documento registrado: la venta es válida y le
                // toca comisión al vendedor aunque falte el CDR. Sin esto la venta
                // quedaba en conciliación y el vendedor nunca cobraba. Idempotente.
                const conDetalles = await this.prisma.comprobante.findUnique({
                  where: { id: comprobante.id },
                  include: { detalles: true },
                });
                if (conDetalles) {
                  await this.enviarSunat.registrarComisionesAlAceptar(
                    conDetalles,
                  );
                }
              } else {
                throw err;
              }
            }
            // Si sigue PENDIENTE tras el reenvío, espaciar el próximo intento.
            // Sin esto el job lo reenviaba cada 5 minutos indefinidamente.
            await this.espaciarSiSiguePendiente(comprobante);
            continue;
          }

          const qpseAccess = await this.qpseClient.obtenerTokenAcceso({
            username: qpseUsername,
            password: qpsePassword,
          });

          let finalResponse: QpseSendResponse;
          try {
            finalResponse = await this.qpseClient.consultarTicket(
              comprobante.documentoId,
              qpseAccess.token_acceso!,
            );
          } catch (ticketErr: any) {
            const errMsg = String(ticketErr?.message || '').toLowerCase();
            // QPSE synchronous documents: CDR was in the original send response — re-evaluate it
            if (
              errMsg.includes('no aplica') ||
              errMsg.includes('use la respuesta')
            ) {
              this.logger.warn(
                `[Job 1] consultarTicket no aplica para ${comprobante.id} → re-evaluando sunatCdrResponse almacenado`,
              );
              const stored = comprobante.sunatCdrResponse
                ? (() => {
                    try {
                      return JSON.parse(comprobante.sunatCdrResponse as string);
                    } catch {
                      return null;
                    }
                  })()
                : null;
              if (!stored) {
                this.logger.warn(
                  `[Job 1] Sin sunatCdrResponse para ${comprobante.id}, no se puede resolver`,
                );
                continue;
              }
              finalResponse = stored as QpseSendResponse;
            } else {
              throw ticketErr;
            }
          }
          const status = this.normalizeQpseStatus(finalResponse);
          const storageUpdate = await this.persistQpseAssets(
            comprobante,
            finalResponse,
          );

          const dataUpdate = {
            estadoEnvioSunat: (status === 'ACEPTADO'
              ? 'EMITIDO'
              : status === 'RECHAZADO'
                ? 'RECHAZADO'
                : 'PENDIENTE') as any,
            sunatCdrZip: finalResponse.cdr || null,
            sunatCdrResponse: JSON.stringify(finalResponse),
            sunatErrorMsg:
              status !== 'ACEPTADO'
                ? this.extractQpseMessage(finalResponse)
                : null,
            // Limpiar contadores de backoff cuando se resuelve exitosamente
            ...(status !== 'PENDIENTE' && { sunatNextRetryAt: null }),
            ...storageUpdate,
          };

          if (status === 'ACEPTADO') {
            await this.prisma.comprobante.update({
              where: { id: comprobante.id },
              data: dataUpdate,
            });
            // La cuenta ya emite: reprogramar los que quedaron trabados por CONFIG.
            this.enviarSunat
              .reprogramarConfigPendientes(comprobante.empresaId, comprobante.id)
              .catch((e: any) =>
                this.logger.warn(`No se pudo reprogramar CONFIG: ${e?.message}`),
              );
          } else {
            // Guard atómico: solo escribir si sigue PENDIENTE, para no pisar un
            // EMITIDO/ANULADO/PENDIENTE_CONCILIACION escrito por otro proceso.
            const res = await this.prisma.comprobante.updateMany({
              where: { id: comprobante.id, estadoEnvioSunat: 'PENDIENTE' },
              data: dataUpdate,
            });
            if (res.count === 0) {
              this.logger.warn(
                `⛔ Comprobante ${comprobante.id} cambió de estado durante la consulta; no se sobrescribe con ${status}`,
              );
              continue;
            }
          }

          // Si fue ACEPTADO, generar y subir el PDF
          if (status === 'ACEPTADO') {
            try {
              await this.enviarSunat.generarYSubirPDF(comprobante.id);
              this.logger.log(
                `📄 PDF generado para comprobante ${comprobante.id}`,
              );
            } catch (pdfErr: any) {
              this.logger.warn(
                `⚠️ Error generando PDF para ${comprobante.id}: ${pdfErr.message}`,
              );
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
            await this.notificacionesService
              .notificarFallaSunat({
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
              })
              .catch(() => {
                /* no bloquear el flujo */
              });
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
            // Guard atómico: no tocar la fila si otro proceso ya la resolvió.
            await this.prisma.comprobante.updateMany({
              where: { id: comprobante.id, estadoEnvioSunat: 'PENDIENTE' },
              data: {
                sunatRetriesCount: newCount,
                sunatLastRetryAt: new Date(),
                sunatNextRetryAt: nextRetry,
                sunatErrorMsg: `[RED] Consulta fallida (intento ${newCount}): ${err.message}`,
              },
            });
          } catch (dbErr: any) {
            this.logger.warn(
              `No se pudo guardar backoff para ${comprobante.id}: ${dbErr.message}`,
            );
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

          this.logger.log(
            `✅ Comprobante ${comprobante.id} enviado exitosamente en reintento`,
          );
        } catch (err: any) {
          if (err instanceof SunatPayloadException) {
            this.logger.warn(
              `[Job 2] Comprobante ${comprobante.id} → error fatal SUNAT, auto-eliminando: ${err.message}`,
            );
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
            await this.notificacionesService
              .notificarFallaSunat({
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
              })
              .catch(() => {
                /* no bloquear el flujo */
              });
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
      const limite = new Date(
        Date.now() - PENDIENTE_STUCK_HORAS * 60 * 60 * 1000,
      );
      const estancados = await this.prisma.comprobante.findMany({
        where: {
          estadoEnvioSunat: 'PENDIENTE',
          documentoId: { not: null },
          creadoEn: { lte: limite },
        },
        select: {
          id: true,
          empresaId: true,
          serie: true,
          correlativo: true,
          tipoDoc: true,
          creadoEn: true,
        },
        take: 20,
        orderBy: { creadoEn: 'asc' },
      });

      if (estancados.length > 0) {
        this.logger.log(
          `[Job 4] ${estancados.length} comprobantes PENDIENTE estancados > ${PENDIENTE_STUCK_HORAS}h`,
        );
      }

      for (const comp of estancados) {
        const ref = `${comp.serie ?? ''}-${String(comp.correlativo ?? '').padStart(8, '0')}`;
        const horasEstancado = Math.floor(
          (Date.now() - comp.creadoEn.getTime()) / (60 * 60 * 1000),
        );
        await this.notificacionesService
          .notificarFallaSunat({
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
          })
          .catch(() => {
            /* no bloquear el flujo */
          });
      }
    } catch (err: any) {
      this.logger.error(
        `Error en notificaciones de pendientes estancados: ${err.message}`,
      );
    }
  }

  /**
   * Le pregunta a SUNAT (API "Consulta de Validez de CPE") si un comprobante que
   * lleva rato en PENDIENTE ya está registrado, y resuelve su estado con esa
   * respuesta. Es la única salida real del limbo "En procesamiento": el CDR pudo
   * perderse en el camino y el proveedor no siempre puede devolverlo.
   *
   * Devuelve `true` cuando el comprobante quedó resuelto (no hay que reenviarlo)
   * y `false` cuando hay que seguir con el flujo de reintento de siempre —
   * incluido el caso de que falten las credenciales de API SUNAT de la empresa,
   * para que esta mejora nunca empeore el comportamiento actual.
   */
  private async resolverPorConsultaValidez(comprobante: any): Promise<boolean> {
    try {
      const horas =
        (Date.now() - new Date(comprobante.creadoEn).getTime()) /
        (60 * 60 * 1000);
      if (horas < PENDIENTE_AUTOVERIFICAR_HORAS) return false;

      const { result } = await this.comprobanteService.consultarValidezSunat(
        comprobante.id,
      );
      // Sin credenciales de API SUNAT, o consulta caída: se sigue como antes.
      if (!result) return false;

      const ref = `${comprobante.serie ?? ''}-${String(comprobante.correlativo ?? '').padStart(8, '0')}`;

      if (result.estado === 'ACEPTADO') {
        // Guard atómico: solo escribir si sigue PENDIENTE, para no pisar un
        // estado que otro proceso ya resolvió mientras consultábamos.
        const res = await this.prisma.comprobante.updateMany({
          where: { id: comprobante.id, estadoEnvioSunat: 'PENDIENTE' },
          data: {
            estadoEnvioSunat: 'EMITIDO' as any,
            sunatNextRetryAt: null,
            sunatErrorMsg:
              'Verificado en SUNAT (Consulta de Validez): comprobante ACEPTADO. CDR no recuperable vía el proveedor.',
          },
        });
        if (res.count === 0) return true;

        this.logger.log(
          `[Job 1] ${ref} confirmado ACEPTADO por Consulta de Validez SUNAT → EMITIDO`,
        );
        // Aceptado por consulta, no por CDR: hay que disparar a mano los efectos
        // que `execute()` aplica al recibir el CDR (comisión del vendedor y, si
        // es nota de crédito, la anulación del documento afectado).
        await this.enviarSunat.aplicarEfectosDeAceptacion(comprobante.id);
        await this.enviarSunat
          .generarYSubirPDF(comprobante.id)
          .catch((e: any) =>
            this.logger.warn(`No se pudo generar PDF de ${ref}: ${e?.message}`),
          );
        await this.notificacionesService
          .notificarFallaSunat({
            empresaId: comprobante.empresaId,
            tipo: 'INFO',
            titulo: 'Comprobante confirmado en SUNAT',
            mensaje: `${ref} figuraba "En procesamiento" pero SUNAT confirma que está ACEPTADO. Ya quedó registrado como aceptado.`,
            meta: {
              comprobanteId: comprobante.id,
              serie: comprobante.serie,
              correlativo: comprobante.correlativo,
              tipoDoc: comprobante.tipoDoc,
            },
          })
          .catch(() => {
            /* no bloquear el flujo */
          });
        return true;
      }

      if (result.estado === 'ANULADO') {
        // SUNAT lo tiene dado de baja. Reenviarlo no tiene sentido.
        await this.prisma.comprobante.updateMany({
          where: { id: comprobante.id, estadoEnvioSunat: 'PENDIENTE' },
          data: {
            estadoEnvioSunat: 'ANULADO' as any,
            sunatNextRetryAt: null,
            sunatErrorMsg:
              'Verificado en SUNAT (Consulta de Validez): comprobante ANULADO / dado de baja.',
          },
        });
        this.logger.log(`[Job 1] ${ref} figura ANULADO en SUNAT → ANULADO`);
        return true;
      }

      // NO_EXISTE: SUNAT no lo tiene. Reenviar es seguro (el número sigue libre).
      // DESCONOCIDO: respuesta no concluyente, mejor seguir con el flujo normal.
      return false;
    } catch (err: any) {
      this.logger.warn(
        `[Job 1] Consulta de Validez falló para ${comprobante.id}: ${err?.message}`,
      );
      return false;
    }
  }

  /**
   * Espacia el siguiente reintento de un comprobante que sigue PENDIENTE después
   * de un reenvío. Sin esto, los tipos síncronos se reenviaban cada 5 minutos de
   * forma indefinida contra un proveedor que ya demostró no tener respuesta.
   * El guard por estado lo hace inocuo si el reenvío sí lo resolvió.
   *
   * El escalón de espera se deriva de la ANTIGÜEDAD del comprobante y no de
   * `sunatRetriesCount` a propósito: ese contador también decide cuándo un
   * comprobante se da por RECHAZADO tras agotar reintentos, y engordarlo aquí
   * adelantaría ese corte para errores que no tienen nada que ver.
   */
  private async espaciarSiSiguePendiente(comprobante: any): Promise<void> {
    try {
      const horas =
        (Date.now() - new Date(comprobante.creadoEn).getTime()) /
        (60 * 60 * 1000);
      // Umbrales en horas → escalón de backoff: 5m, 15m, 1h, 4h, 12h, 24h.
      const escalon = [1, 4, 12, 24, 72].filter((h) => horas >= h).length;
      await this.prisma.comprobante.updateMany({
        where: { id: comprobante.id, estadoEnvioSunat: 'PENDIENTE' },
        data: {
          sunatLastRetryAt: new Date(),
          sunatNextRetryAt: this.enviarSunat.calculateNetworkRetry(escalon),
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `No se pudo espaciar el reintento de ${comprobante.id}: ${err?.message}`,
      );
    }
  }

  /**
   * Job 5: avisar de anulaciones que el sistema dio por hechas pero SUNAT no.
   *
   * Al emitir una nota de crédito de anulación (motivo 01/06) el comprobante
   * afectado se marca ANULADO de inmediato, para que deje de contar en caja,
   * reportes y cobranzas. Si esa nota termina RECHAZADA por SUNAT, la boleta
   * queda anulada en el sistema pero VIGENTE ante SUNAT: una discrepancia que
   * nadie ve hasta que llega una fiscalización. Esto la hace visible.
   */
  async notificarAnulacionesNoConfirmadas(): Promise<void> {
    try {
      // Acotado a los últimos 90 días: el histórico antiguo ya no es accionable
      // y avisar de él solo sería ruido en la campana de notificaciones.
      const desde = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const notasFallidas = await this.prisma.comprobante.findMany({
        where: {
          tipoDoc: '07',
          estadoEnvioSunat: { in: ['RECHAZADO', 'FALLIDO_ENVIO'] as any },
          numDocAfectado: { not: null },
          creadoEn: { gte: desde },
          motivo: { codigo: { in: ['01', '06'] } },
        },
        select: {
          id: true,
          empresaId: true,
          serie: true,
          correlativo: true,
          tipoDoc: true,
          numDocAfectado: true,
          sunatErrorMsg: true,
        },
        take: 50,
        orderBy: { id: 'desc' },
      });

      if (notasFallidas.length === 0) return;

      // Solo hay discrepancia si el documento afectado quedó efectivamente
      // ANULADO en el sistema. Si no lo está, no hay nada que avisar.
      const series = new Set<string>();
      for (const nota of notasFallidas) {
        const serie = String(nota.numDocAfectado).split('-')[0];
        if (serie) series.add(serie.toUpperCase());
      }
      const afectados = await this.prisma.comprobante.findMany({
        where: {
          tipoDoc: { in: ['01', '03'] },
          estadoEnvioSunat: 'ANULADO' as any,
          empresaId: {
            in: [...new Set(notasFallidas.map((n) => n.empresaId))],
          },
          serie: { in: [...series] },
        },
        select: { serie: true, correlativo: true, empresaId: true },
      });
      const anulados = new Set<string>();
      for (const a of afectados) {
        for (const corr of [
          String(a.correlativo),
          String(a.correlativo).padStart(8, '0'),
        ]) {
          anulados.add(`${a.empresaId}|${a.serie}-${corr}`.toUpperCase());
        }
      }

      const discrepantes = notasFallidas.filter((n) =>
        anulados.has(
          `${n.empresaId}|${String(n.numDocAfectado)}`.toUpperCase(),
        ),
      );

      if (discrepantes.length > 0) {
        this.logger.log(
          `[Job 5] ${discrepantes.length} anulaciones marcadas en el sistema que SUNAT no aceptó`,
        );
      }

      for (const nota of discrepantes) {
        const ref = `${nota.serie ?? ''}-${String(nota.correlativo ?? '').padStart(8, '0')}`;
        const detalle = String(nota.sunatErrorMsg || '')
          .replace(/^\[(DATOS|RED|CONFIG)\]\s*(\(intento \d+\/\d+\):\s*)?/i, '')
          .trim();
        await this.notificacionesService
          .notificarFallaSunat({
            empresaId: nota.empresaId,
            tipo: 'CRITICAL',
            titulo: 'Anulación no confirmada por SUNAT',
            mensaje:
              `${nota.numDocAfectado} figura ANULADO en el sistema, pero la nota de crédito ${ref} que lo anula ` +
              `no fue aceptada por SUNAT${detalle ? `: ${detalle}` : ''}. Ante SUNAT el documento sigue vigente: ` +
              `corrige la nota y reemítela desde Comprobantes → Reemitir a SUNAT.`,
            meta: {
              comprobanteId: nota.id,
              serie: nota.serie,
              correlativo: nota.correlativo,
              tipoDoc: nota.tipoDoc,
              errorMsg: detalle || undefined,
            },
          })
          .catch(() => {
            /* no bloquear el flujo */
          });
      }
    } catch (err: any) {
      this.logger.error(
        `Error notificando anulaciones no confirmadas: ${err.message}`,
      );
    }
  }

  private normalizeQpseStatus(
    response: QpseSendResponse | null | undefined,
  ): 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO' {
    const stateLabel = String(response?.state_label || '').toLowerCase();
    const code = String(response?.code ?? '');

    if (
      response?.sunat_success === true ||
      stateLabel === 'aceptado' ||
      stateLabel === 'observado' ||
      code === '0'
    ) {
      return 'ACEPTADO';
    }

    if (
      stateLabel === 'pendiente' ||
      stateLabel === 'en_proceso' ||
      stateLabel === 'indeterminado' ||
      // 'registrado': QPSE recibió el documento pero aún no hay CDR definitivo.
      // Antes caía al RECHAZADO por defecto y generaba falsos rechazos.
      stateLabel === 'registrado' ||
      code === '98'
    ) {
      return 'PENDIENTE';
    }

    return 'RECHAZADO';
  }

  private extractQpseMessage(
    response: QpseSendResponse | null | undefined,
  ): string {
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

  private async persistQpseAssets(
    comprobante: any,
    response: QpseSendResponse,
  ) {
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
      this.logger.warn(
        `No se pudieron persistir assets SUNAT para ${comprobante.id}: ${error.message}`,
      );
    }

    return updates;
  }

  /** Elimina un comprobante con error fatal SUNAT, guarda log y respeta orden de FKs. */
  private async autoEliminarComprobante(
    id: number,
    errorMsg?: string,
  ): Promise<void> {
    try {
      // Obtener datos del comprobante para el log antes de borrarlo
      const comp = await this.prisma.comprobante.findUnique({
        where: { id },
        select: {
          id: true,
          empresaId: true,
          serie: true,
          correlativo: true,
          tipoDoc: true,
          sunatErrorMsg: true,
        },
      });

      if (comp) {
        await this.comprobanteService.guardarLogErrorFatal({
          empresaId: comp.empresaId,
          serie: comp.serie,
          correlativo: comp.correlativo,
          tipoDoc: comp.tipoDoc,
          errorMsg:
            errorMsg ?? comp.sunatErrorMsg ?? 'Error fatal SUNAT (scheduler)',
        });
      }

      await this.prisma.$transaction(async (tx) => {
        const movimientos = await tx.movimientoKardex.findMany({
          where: { comprobanteId: id },
          select: { id: true },
        });
        if (movimientos.length) {
          const movIds = movimientos.map((m) => m.id);
          await tx.movimientoKardexLote.deleteMany({
            where: { movimientoId: { in: movIds } },
          });
          await tx.movimientoKardex.deleteMany({
            where: { id: { in: movIds } },
          });
        }
        await tx.detalleComprobante.deleteMany({
          where: { comprobanteId: id },
        });
        await tx.leyenda.deleteMany({ where: { comprobanteId: id } });
        await tx.comprobante.delete({ where: { id } });
      });
      this.logger.log(
        `🗑️ Comprobante ${id} eliminado automáticamente (error SUNAT fatal)`,
      );
    } catch (err: any) {
      this.logger.error(
        `Error al auto-eliminar comprobante ${id}: ${err.message}`,
      );
    }
  }
}
