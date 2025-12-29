import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VerificarPendientesSunatService } from './services/verificar-pendientes-sunat.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { InventarioNotificacionesService } from '../notificaciones/inventario-notificaciones.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly verificarSunat: VerificarPendientesSunatService,
    private readonly notificacionesService: NotificacionesService,
    private readonly inventarioNotificacionesService: InventarioNotificacionesService,
  ) { }

  // Job 1: Check status of PENDIENTE invoices with documentoId (every 30 min)
  @Cron(CronExpression.EVERY_30_MINUTES)
  async verificarComprobantesPendientes(): Promise<void> {
    this.logger.log(
      '🔍 [Job 1] Verificando comprobantes PENDIENTES con documentoId...',
    );
    await this.verificarSunat.execute();
    this.logger.log('[Job 1] Verificación completada.');
  }

  // Job 2: Retry FALLIDO_ENVIO invoices that are ready for retry (every 5 min)
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reintentarEnviosFallidos(): Promise<void> {
    this.logger.log(
      '🔄 [Job 2] Reintentando envíos fallidos...',
    );
    await this.verificarSunat.reintentarEnviosFallidos();
    this.logger.log('[Job 2] Reintentos completados.');
  }

  // Verificar suscripciones todos los días a las 9 AM
  @Cron('0 9 * * *', {
    name: 'verificar-suscripciones',
    timeZone: 'America/Lima',
  })
  async verificarSuscripciones(): Promise<void> {
    this.logger.log('🔔 Iniciando verificación de suscripciones...');
    try {
      const resultado = await this.notificacionesService.verificarSuscripcionesProximasVencer();
      this.logger.log(`✅ Verificación completada. ${resultado.total} notificaciones creadas.`);
    } catch (error) {
      this.logger.error('❌ Error al verificar suscripciones:', error);
    }
  }

  // Verificar inventario todos los días a las 8 AM
  @Cron('0 8 * * *', {
    name: 'verificar-inventario',
    timeZone: 'America/Lima',
  })
  async verificarInventario(): Promise<void> {
    this.logger.log('📦 Iniciando verificación de inventario...');
    try {
      await this.inventarioNotificacionesService.verificarInventarioTodasEmpresas();
      this.logger.log('✅ Verificación de inventario completada');
    } catch (error) {
      this.logger.error('❌ Error al verificar inventario:', error);
    }
  }
}
