import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesGateway } from './notificaciones.gateway';

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
  }) {
    const notificacion = await this.prisma.notificacion.create({
      data: {
        ...data,
        leida: false,
      },
    });

    // Enviar notificación en tiempo real via WebSocket
    this.gateway.enviarNotificacionAUsuario(data.usuarioId, notificacion);

    return notificacion;
  }

  // Enviar notificación en tiempo real usando el gateway
  emitirNotificacionEnTiempoReal(usuarioId: number, notificacion: any) {
    if (this.gateway) {
      this.gateway.enviarNotificacionAUsuario(usuarioId, notificacion);
    }
  }
}
