import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesGateway } from './notificaciones.gateway';

export interface SunatNotifMeta {
  comprobanteId?: number;
  guiaId?: number;
  serie?: string | null;
  correlativo?: number | null;
  tipoDoc?: string | null;
  errorMsg?: string | null;
}

@Injectable()
export class NotificacionesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotificacionesGateway))
    private readonly gateway: NotificacionesGateway,
  ) {}

  // Verificar suscripciones próximas a vencer
  async verificarSuscripcionesProximasVencer() {
    const hoy = new Date();
    const en7Dias = new Date();
    en7Dias.setDate(hoy.getDate() + 7);
    const en3Dias = new Date();
    en3Dias.setDate(hoy.getDate() + 3);
    const en1Dia = new Date();
    en1Dia.setDate(hoy.getDate() + 1);

    // Empresas que vencen en 7 días
    const empresas7Dias = await this.prisma.empresa.findMany({
      where: {
        fechaExpiracion: {
          gte: hoy,
          lte: en7Dias,
        },
        estado: 'ACTIVO',
      },
      include: {
        usuarios: {
          where: { rol: 'ADMIN_EMPRESA' },
          select: { id: true, nombre: true, email: true },
        },
        plan: { select: { nombre: true } },
      },
    });

    // Crear notificaciones para cada empresa
    const notificaciones: any[] = [];

    for (const empresa of empresas7Dias) {
      const diasRestantes = Math.ceil(
        (empresa.fechaExpiracion.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24),
      );

      let tipo: 'INFO' | 'WARNING' | 'CRITICAL' = 'INFO';
      let mensaje = '';

      if (diasRestantes <= 1) {
        tipo = 'CRITICAL';
        mensaje = `¡Tu suscripción vence mañana! Renueva ahora para evitar interrupciones.`;
      } else if (diasRestantes <= 3) {
        tipo = 'WARNING';
        mensaje = `Tu suscripción vence en ${diasRestantes} días. Considera renovar pronto.`;
      } else {
        tipo = 'INFO';
        mensaje = `Tu suscripción vence en ${diasRestantes} días.`;
      }

      // Crear notificación para cada admin de la empresa
      for (const usuario of empresa.usuarios) {
        const notificacion = await this.prisma.notificacion.create({
          data: {
            usuarioId: usuario.id,
            empresaId: empresa.id,
            tipo,
            titulo: 'Renovación de Suscripción',
            mensaje,
            leida: false,
          },
        });
        notificaciones.push(notificacion);

        // Enviar notificación en tiempo real via WebSocket
        this.gateway.enviarNotificacionAUsuario(usuario.id, notificacion);
      }
    }

    return {
      total: notificaciones.length,
      notificaciones,
    };
  }

  // Obtener notificaciones de un usuario
  async obtenerNotificacionesUsuario(usuarioId: number, limit = 20) {
    const notificaciones = await this.prisma.notificacion.findMany({
      where: { usuarioId },
      orderBy: { creadoEn: 'desc' },
      take: limit,
    });

    const noLeidas = await this.prisma.notificacion.count({
      where: { usuarioId, leida: false },
    });

    return {
      notificaciones,
      noLeidas,
    };
  }

  // Marcar notificación como leída
  async marcarComoLeida(notificacionId: number, usuarioId: number) {
    const notificacion = await this.prisma.notificacion.findFirst({
      where: { id: notificacionId, usuarioId },
    });

    if (!notificacion) {
      throw new Error('Notificación no encontrada');
    }

    return await this.prisma.notificacion.update({
      where: { id: notificacionId },
      data: { leida: true },
    });
  }

  // Marcar todas como leídas
  async marcarTodasComoLeidas(usuarioId: number) {
    return await this.prisma.notificacion.updateMany({
      where: { usuarioId, leida: false },
      data: { leida: true },
    });
  }

  // Crear notificación manual
  async crearNotificacion(data: {
    usuarioId: number;
    empresaId?: number;
    tipo: 'INFO' | 'WARNING' | 'CRITICAL';
    titulo: string;
    mensaje: string;
    metaData?: SunatNotifMeta;
  }) {
    const notificacion = await this.prisma.notificacion.create({
      data: {
        ...data,
        metaData: data.metaData as Prisma.InputJsonValue | undefined,
        leida: false,
      },
    });

    // Enviar notificación en tiempo real via WebSocket
    this.gateway.enviarNotificacionAUsuario(data.usuarioId, notificacion);

    return notificacion;
  }

  /**
   * Notifica a todos los ADMIN_EMPRESA de una empresa sobre un fallo SUNAT.
   * Incluye dedup: no crea otra notificación si ya existe una no-leída del mismo
   * comprobante en las últimas 24 horas.
   */
  async notificarFallaSunat(params: {
    empresaId: number;
    tipo: 'CRITICAL' | 'WARNING' | 'INFO';
    titulo: string;
    mensaje: string;
    meta: SunatNotifMeta;
  }) {
    const { empresaId, tipo, titulo, mensaje, meta } = params;

    // Dedup por comprobanteId o guiaId en las últimas 24 h
    const refId = meta.comprobanteId ?? meta.guiaId;
    const refKey = meta.comprobanteId ? 'comprobanteId' : 'guiaId';
    if (refId !== undefined) {
      const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const yaExiste = await (this.prisma.notificacion as any).findFirst({
        where: {
          empresaId,
          titulo,
          leida: false,
          creadoEn: { gte: hace24h },
          metaData: { path: [refKey], equals: refId },
        },
      });
      if (yaExiste) return;
    }

    const admins = await this.prisma.usuario.findMany({
      where: { empresaId, rol: 'ADMIN_EMPRESA' },
      select: { id: true },
    });

    for (const admin of admins) {
      const notif = await this.prisma.notificacion.create({
        data: {
          usuarioId: admin.id,
          empresaId,
          tipo,
          titulo,
          mensaje,
          leida: false,
          metaData: meta as any,
        },
      });
      this.gateway.enviarNotificacionAUsuario(admin.id, notif);
    }
  }

  // Enviar notificación en tiempo real usando el gateway
  emitirNotificacionEnTiempoReal(usuarioId: number, notificacion: any) {
    if (this.gateway) {
      this.gateway.enviarNotificacionAUsuario(usuarioId, notificacion);
    }
  }
}
