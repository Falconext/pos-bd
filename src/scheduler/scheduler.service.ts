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

      // 4) Correos de recordatorio (empresa + cliente) a 15, 5, 1 y 0 días del vencimiento.
      await this.enviarCorreosVencimientoContratos();

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

  // ── Correos de recordatorio de vencimiento de contrato vehicular ────────────
  // Envía a la empresa (admins) y al cliente cuando faltan 15, 5, 1 o 0 días.
  private async enviarCorreosVencimientoContratos(): Promise<void> {
    if (!process.env.RESEND_API_KEY) return; // sin proveedor de correo, no hace nada

    const hoy = new Date();
    const desde = new Date(hoy); desde.setDate(desde.getDate() - 1);
    const hasta = new Date(hoy); hasta.setDate(hasta.getDate() + 16);

    const contratos = await this.prisma.contratoVehicular.findMany({
      where: {
        estado: { in: ['VIGENTE', 'POR_VENCER'] },
        fechaFin: { gte: desde, lte: hasta },
      },
      include: {
        vehiculo: {
          select: {
            placa: true, marca: true, modelo: true,
            cliente: { select: { nombre: true, email: true } },
          },
        },
        producto: { select: { descripcion: true } },
        empresa: { select: { id: true, brand: true, nombreComercial: true, razonSocial: true } },
      },
    });
    if (!contratos.length) return;

    // Comparación por fecha de calendario (UTC) para no depender de la zona horaria.
    const UMBRALES = [15, 5, 1, 0];
    const utcStr = (base: Date, addDays: number) =>
      new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + addDays))
        .toISOString().slice(0, 10);
    const targets = new Map<string, number>();
    for (const n of UMBRALES) targets.set(utcStr(hoy, n), n);

    // Cache de emails de administradores por empresa.
    const adminsCache = new Map<number, { email: string; nombre: string }[]>();
    const getAdmins = async (empresaId: number) => {
      if (adminsCache.has(empresaId)) return adminsCache.get(empresaId)!;
      const admins = await this.prisma.usuario.findMany({
        where: { empresaId, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
        select: { email: true, nombre: true },
      });
      adminsCache.set(empresaId, admins as any);
      return admins as any;
    };

    const appUrl = (process.env.FRONTEND_URL || 'https://app.falconext.pe').replace(/\/$/, '');
    let enviados = 0;

    for (const c of contratos) {
      const fechaFinStr = new Date(c.fechaFin).toISOString().slice(0, 10);
      const dias = targets.get(fechaFinStr);
      if (dias === undefined) continue; // no cae en ningún umbral hoy

      const placa = c.vehiculo?.placa || '—';
      const vehiculoDesc = [c.vehiculo?.marca, c.vehiculo?.modelo].filter(Boolean).join(' ') || undefined;
      const servicio = c.producto?.descripcion || undefined;
      const appName = c.empresa?.brand === 'krezka' ? 'Krezka' : 'Falconext';
      const negocioNombre = c.empresa?.nombreComercial || c.empresa?.razonSocial || undefined;
      const fechaVencimiento = new Intl.DateTimeFormat('es-PE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      }).format(new Date(c.fechaFin));

      // 1) Cliente dueño del vehículo (si tiene correo).
      const clienteEmail = c.vehiculo?.cliente?.email;
      if (clienteEmail) {
        try {
          await this.enviarCorreoVencimiento(clienteEmail, {
            destinatarioNombre: c.vehiculo?.cliente?.nombre || 'Estimado cliente',
            esCliente: true, placa, vehiculoDesc, servicio,
            diasRestantes: dias, fechaVencimiento, negocioNombre, appName,
          });
          enviados++;
        } catch (e: any) { this.logger.error(`Correo cliente contrato ${c.id}: ${e?.message || e}`); }
      }

      // 2) Administradores de la empresa.
      const admins = await getAdmins(c.empresa?.id ?? c.empresaId);
      for (const a of admins) {
        if (!a.email) continue;
        try {
          await this.enviarCorreoVencimiento(a.email, {
            destinatarioNombre: a.nombre || 'Administrador',
            esCliente: false, placa, vehiculoDesc, servicio,
            diasRestantes: dias, fechaVencimiento, negocioNombre, appName,
            ctaUrl: `${appUrl}/administrador/vehiculos/contratos`,
          });
          enviados++;
        } catch (e: any) { this.logger.error(`Correo empresa contrato ${c.id}: ${e?.message || e}`); }
      }
    }

    if (enviados) this.logger.log(`📧 Recordatorios de vencimiento enviados: ${enviados}`);
  }

  // Renderiza y envía el correo de vencimiento con Resend (mismo patrón del proyecto).
  private async enviarCorreoVencimiento(to: string, props: any): Promise<void> {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;
    const { Resend } = await import('resend');
    const { render } = await import('@react-email/render');
    const { VencimientoContratoEmail } = await import(
      '../empresa/emails/VencimientoContratoEmail.js'
    );
    const resend = new Resend(resendKey);
    const fromEmail =
      process.env.RESEND_FROM_EMAIL || process.env.MAIL_FROM || 'noreply@falconext.pe';
    const html = await render((VencimientoContratoEmail as any)(props));
    const asunto =
      props.diasRestantes === 0
        ? `Vence hoy: contrato del vehículo ${props.placa}`
        : props.diasRestantes === 1
          ? `Vence mañana: contrato del vehículo ${props.placa}`
          : `Vence en ${props.diasRestantes} días: contrato del vehículo ${props.placa}`;
    const { error } = await resend.emails.send({
      from: `${props.appName} <${fromEmail}>`,
      to,
      subject: asunto,
      html,
    });
    if (error) throw new Error(error.message);
  }
}
