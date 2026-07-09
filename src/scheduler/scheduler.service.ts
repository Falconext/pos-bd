import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VerificarPendientesSunatService } from './services/verificar-pendientes-sunat.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { InventarioNotificacionesService } from '../notificaciones/inventario-notificaciones.service';
import { ResellerService } from '../reseller/reseller.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly verificarSunat: VerificarPendientesSunatService,
    private readonly notificacionesService: NotificacionesService,
    private readonly inventarioNotificacionesService: InventarioNotificacionesService,
    private readonly resellerService: ResellerService,
    private readonly prisma: PrismaService,
  ) {}

  // Job 1: Check status of PENDIENTE invoices with documentoId (every 5 min)
  @Cron(CronExpression.EVERY_5_MINUTES)
  async verificarComprobantesPendientes(): Promise<void> {
    try {
      await this.verificarSunat.execute();
    } catch (error: any) {
      this.logger.error(
        `[Job 1] Error al verificar comprobantes pendientes: ${error?.message || 'Error desconocido'}`,
      );
    }
  }

  // Job 2: Retry FALLIDO_ENVIO invoices and guías that are ready for retry (every 5 min)
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reintentarEnviosFallidos(): Promise<void> {
    try {
      // Reintentar Comprobantes
      await this.verificarSunat.reintentarEnviosFallidos();

      // Reintentar Guías de Remisión
      await this.verificarSunat.reintentarGuiasFallidas();
    } catch (error: any) {
      this.logger.error(
        `[Job 2] Error al reintentar envíos fallidos: ${error?.message || 'Error desconocido'}`,
      );
    }
  }

  // Job 4: Notificar comprobantes PENDIENTE estancados más de 2h (cada hora)
  @Cron('0 * * * *', {
    name: 'notificar-pendientes-estancados',
    timeZone: 'America/Lima',
  })
  async notificarPendientesEstancados(): Promise<void> {
    try {
      await this.verificarSunat.notificarPendientesEstancados();
    } catch (error: any) {
      this.logger.error(
        `[Job 4] Error al notificar pendientes estancados: ${error?.message}`,
      );
    }
  }

  // Verificar suscripciones todos los días a las 9 AM
  @Cron('0 9 * * *', {
    name: 'verificar-suscripciones',
    timeZone: 'America/Lima',
  })
  async verificarSuscripciones(): Promise<void> {
    this.logger.log('🔔 Iniciando verificación de suscripciones...');
    try {
      const resultado =
        await this.notificacionesService.verificarSuscripcionesProximasVencer();
      this.logger.log(
        `✅ Verificación completada. ${resultado.total} notificaciones creadas.`,
      );
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

  // Alertas de vencimiento de lotes farmacéuticos — todos los días a las 8:15 AM
  @Cron('15 8 * * *', {
    name: 'alertar-lotes-vencimiento',
    timeZone: 'America/Lima',
  })
  async alertarLotesVencimiento(): Promise<void> {
    this.logger.log('💊 Iniciando alertas de vencimiento de lotes...');
    try {
      const resultado =
        await this.inventarioNotificacionesService.alertarLotesVencimientoProximo();
      this.logger.log(
        `✅ Alertas de vencimiento completadas. ${resultado.total} notificaciones enviadas.`,
      );
    } catch (error) {
      this.logger.error('❌ Error al alertar vencimientos de lotes:', error);
    }
  }

  @Cron('10 9 * * *', {
    name: 'renovar-clientes-reseller',
    timeZone: 'America/Lima',
  })
  async renovarClientesReseller(): Promise<void> {
    this.logger.log('💼 Iniciando renovación mensual de clientes reseller...');
    try {
      const resultado = await this.resellerService.processMonthlyRenewals();
      this.logger.log(
        `✅ Renovación reseller completada. Evaluadas: ${resultado.totalEvaluadas}, renovadas: ${resultado.renovadas}, suspendidas: ${resultado.suspendidas}`,
      );
    } catch (error) {
      this.logger.error('❌ Error en renovación mensual reseller:', error);
    }
  }

  // Actualizar estados de contratos vehiculares — todos los días a las 7 AM
  @Cron('0 7 * * *', {
    name: 'actualizar-contratos-vehiculares',
    timeZone: 'America/Lima',
  })
  async actualizarContratosVehiculares(): Promise<void> {
    this.logger.log('🚗 Actualizando estados de contratos vehiculares...');
    try {
      const hoy = new Date();
      const en30dias = new Date();
      en30dias.setDate(en30dias.getDate() + 30);

      // 1) Contratos que pasan a VENCIDO: capturarlos ANTES de actualizar para poder notificar.
      const porVencerAhoraVencidos =
        await this.prisma.contratoVehicular.findMany({
          where: {
            fechaFin: { lt: hoy },
            estado: { in: ['VIGENTE', 'POR_VENCER'] },
          },
          select: {
            id: true,
            empresaId: true,
            fechaFin: true,
            vehiculo: { select: { placa: true } },
          },
        });
      const vencidos = await this.prisma.contratoVehicular.updateMany({
        where: {
          fechaFin: { lt: hoy },
          estado: { in: ['VIGENTE', 'POR_VENCER'] },
        },
        data: { estado: 'VENCIDO' },
      });

      // 2) Contratos que pasan a POR_VENCER (vencen dentro de 30 días).
      const nuevosPorVencer = await this.prisma.contratoVehicular.findMany({
        where: { fechaFin: { gte: hoy, lte: en30dias }, estado: 'VIGENTE' },
        select: {
          id: true,
          empresaId: true,
          fechaFin: true,
          vehiculo: { select: { placa: true } },
        },
      });
      const porVencer = await this.prisma.contratoVehicular.updateMany({
        where: { fechaFin: { gte: hoy, lte: en30dias }, estado: 'VIGENTE' },
        data: { estado: 'POR_VENCER' },
      });

      // 3) Notificar a los admins de cada empresa (agrupado por empresa).
      await this.notificarContratos(porVencerAhoraVencidos, 'VENCIDO');
      await this.notificarContratos(nuevosPorVencer, 'POR_VENCER');

      this.logger.log(
        `✅ Contratos: ${vencidos.count} marcados VENCIDO, ${porVencer.count} marcados POR_VENCER`,
      );
    } catch (error) {
      this.logger.error('❌ Error al actualizar contratos vehiculares:', error);
    }
  }

  // Agrupa los contratos por empresa y envía una notificación in-app a los admins.
  private async notificarContratos(
    contratos: {
      id: number;
      empresaId: number;
      fechaFin: Date;
      vehiculo?: { placa: string } | null;
    }[],
    tipo: 'VENCIDO' | 'POR_VENCER',
  ): Promise<void> {
    if (!contratos.length) return;
    const porEmpresa = new Map<number, { placas: string[]; ids: number[] }>();
    for (const c of contratos) {
      if (!c.empresaId) continue;
      const entry = porEmpresa.get(c.empresaId) || { placas: [], ids: [] };
      if (c.vehiculo?.placa) entry.placas.push(c.vehiculo.placa);
      entry.ids.push(c.id);
      porEmpresa.set(c.empresaId, entry);
    }

    for (const [empresaId, { placas, ids }] of porEmpresa.entries()) {
      const cantidad = ids.length;
      const listaPlacas =
        placas.slice(0, 5).join(', ') + (placas.length > 5 ? '…' : '');
      const esVencido = tipo === 'VENCIDO';
      try {
        await this.notificacionesService.notificarAdminsEmpresa({
          empresaId,
          tipo: esVencido ? 'CRITICAL' : 'WARNING',
          titulo: esVencido
            ? `${cantidad} contrato(s) de monitoreo vencido(s)`
            : `${cantidad} contrato(s) por vencer (30 días)`,
          mensaje: esVencido
            ? `Los siguientes vehículos tienen su suscripción de monitoreo VENCIDA: ${listaPlacas}. Renuévalos para no interrumpir el servicio.`
            : `Los siguientes vehículos vencen su suscripción en los próximos 30 días: ${listaPlacas}. Considera renovarlos.`,
          metaData: {
            modulo: 'contratos-vehiculares',
            estado: tipo,
            contratoIds: ids,
            placas,
          },
        });
      } catch (e: any) {
        this.logger.error(
          `No se pudo notificar contratos (${tipo}) empresa ${empresaId}: ${e?.message || e}`,
        );
      }
    }
  }
}
