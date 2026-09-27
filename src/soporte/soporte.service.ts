import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';

/**
 * Chat de soporte: un hilo continuo por empresa (no un sistema de tickets con
 * varios hilos). El empresario escribe desde /administrador/soporte y el
 * equipo de Krezka responde desde la bandeja /administrador/sistema/soporte.
 */
@Injectable()
export class SoporteService {
  private readonly logger = new Logger(SoporteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  /**
   * El hilo de la empresa, creándolo si es su primera consulta.
   *
   * Dos personas de la misma empresa escribiendo a la vez llegaban las dos a
   * la creación y, como `empresaId` es único, a una le explotaba el envío con
   * P2002. Le pasa justo a quien estrena el chat, que es el peor momento para
   * que falle.
   *
   * El `upsert` de Prisma tampoco alcanza —también termina en P2002 cuando las
   * dos entran juntas—, así que se atrapa el choque y se relee: el hilo lo
   * acaba de crear la otra, y es el mismo que esta necesita.
   */
  private async obtenerOCrearConversacion(empresaId: number) {
    const existente = await this.prisma.soporteConversacion.findUnique({
      where: { empresaId },
    });
    if (existente) return existente;
    try {
      return await this.prisma.soporteConversacion.create({ data: { empresaId } });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const creadaPorLaOtra = await this.prisma.soporteConversacion.findUnique({
        where: { empresaId },
      });
      if (!creadaPorLaOtra) throw error;
      return creadaPorLaOtra;
    }
  }

  // ── Lado empresa ────────────────────────────────────────────────────────

  /** Solo el contador de no leídos, sin marcar nada como leído (para el badge del widget cerrado). */
  async estado(empresaId: number) {
    const conversacion = await this.obtenerOCrearConversacion(empresaId);
    return { noLeidos: conversacion.noLeidosEmpresa };
  }

  /** Historial del hilo de la empresa. Marca como leídos los mensajes de Krezka. */
  async listarMensajes(empresaId: number) {
    const conversacion = await this.obtenerOCrearConversacion(empresaId);
    if (conversacion.noLeidosEmpresa > 0) {
      await this.prisma.soporteConversacion.update({
        where: { id: conversacion.id },
        data: { noLeidosEmpresa: 0 },
      });
    }
    const mensajes = await this.prisma.soporteMensaje.findMany({
      where: { conversacionId: conversacion.id },
      orderBy: { creadoEn: 'asc' },
    });
    return { estado: conversacion.estado, mensajes };
  }

  async enviarMensajeEmpresa(
    empresaId: number,
    usuarioId: number,
    contenido: string,
  ) {
    const texto = contenido.trim();
    // Antes se devolvía OK sin guardar nada: el que escribía solo espacios veía
    // su mensaje desaparecer sin explicación.
    if (!texto) throw new BadRequestException('Escribe un mensaje');

    const autorNombre = await this.resolveUsuarioNombre(usuarioId);
    const conversacion = await this.obtenerOCrearConversacion(empresaId);
    const [, actualizada] = await this.prisma.$transaction([
      this.prisma.soporteMensaje.create({
        data: {
          conversacionId: conversacion.id,
          rol: 'EMPRESA',
          autorNombre,
          contenido: texto,
        },
      }),
      this.prisma.soporteConversacion.update({
        where: { id: conversacion.id },
        data: {
          estado: 'ABIERTA',
          noLeidosSistema: { increment: 1 },
        },
      }),
    ]);

    // El aviso va DESPUÉS de guardar, así que si falla el mensaje ya está en
    // la base. Dejar que el error suba haría que el empresario vea un fallo,
    // reintente y termine con el mensaje duplicado. Un socket caído no puede
    // costarle eso: se avisa lo que se pueda y el envío se da por hecho.
    await this.notificarSistema(empresaId, actualizada.id, autorNombre, texto).catch(
      (error) =>
        this.logger.warn(
          `[soporte] no se pudo avisar a Krezka del mensaje de la empresa ${empresaId}: ${error?.message}`,
        ),
    );
    return actualizada;
  }

  /** Notifica en vivo a los ADMIN_SISTEMA del brand de la empresa (o sin brand = todos). */
  private async notificarSistema(
    empresaId: number,
    conversacionId: number,
    autorNombre: string,
    contenido: string,
  ) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { brand: true, nombreComercial: true, razonSocial: true },
    });
    const admins = await this.prisma.usuario.findMany({
      where: {
        rol: 'ADMIN_SISTEMA',
        OR: [{ sistemaNegocio: null }, { sistemaNegocio: empresa?.brand?.toUpperCase() }],
      },
      select: { id: true },
    });
    if (!admins.length) return;
    this.notificaciones.emitirEventoAUsuarios(
      admins.map((a) => a.id),
      'nuevo-mensaje-soporte',
      {
        conversacionId,
        empresaId,
        empresaNombre: empresa?.nombreComercial || empresa?.razonSocial,
        autorNombre,
        contenido,
        rol: 'EMPRESA',
      },
    );
  }

  // ── Lado sistema (Krezka) ───────────────────────────────────────────────

  async listarConversacionesSistema(
    sistemaNegocio: string | null,
    estado?: 'ABIERTA' | 'CERRADA',
  ) {
    const conversaciones = await this.prisma.soporteConversacion.findMany({
      where: {
        ...(estado ? { estado } : {}),
        empresa: sistemaNegocio ? { brand: sistemaNegocio.toLowerCase() } : undefined,
      },
      include: {
        empresa: { select: { nombreComercial: true, razonSocial: true, brand: true } },
        mensajes: { orderBy: { creadoEn: 'desc' }, take: 1 },
      },
      orderBy: { actualizadoEn: 'desc' },
    });
    return conversaciones.map((c) => ({
      id: c.id,
      empresaId: c.empresaId,
      empresaNombre: c.empresa.nombreComercial || c.empresa.razonSocial,
      brand: c.empresa.brand,
      estado: c.estado,
      asignadoANombre: c.asignadoANombre,
      noLeidosSistema: c.noLeidosSistema,
      ultimoMensaje: c.mensajes[0]?.contenido ?? null,
      actualizadoEn: c.actualizadoEn,
    }));
  }

  private async obtenerConversacionEscopeada(
    id: number,
    sistemaNegocio: string | null,
  ) {
    const conversacion = await this.prisma.soporteConversacion.findUnique({
      where: { id },
      include: { empresa: { select: { brand: true, nombreComercial: true, razonSocial: true } } },
    });
    if (!conversacion) throw new NotFoundException('Conversación no encontrada');
    if (sistemaNegocio && conversacion.empresa.brand !== sistemaNegocio.toLowerCase()) {
      throw new NotFoundException('Conversación no encontrada');
    }
    return conversacion;
  }

  async obtenerConversacionSistema(id: number, sistemaNegocio: string | null) {
    const conversacion = await this.obtenerConversacionEscopeada(id, sistemaNegocio);
    if (conversacion.noLeidosSistema > 0) {
      await this.prisma.soporteConversacion.update({
        where: { id },
        data: { noLeidosSistema: 0 },
      });
    }
    const mensajes = await this.prisma.soporteMensaje.findMany({
      where: { conversacionId: id },
      orderBy: { creadoEn: 'asc' },
    });
    return {
      id: conversacion.id,
      empresaId: conversacion.empresaId,
      empresaNombre: conversacion.empresa.nombreComercial || conversacion.empresa.razonSocial,
      estado: conversacion.estado,
      mensajes,
    };
  }

  async enviarMensajeSistema(
    id: number,
    sistemaNegocio: string | null,
    autorId: number,
    contenido: string,
  ) {
    const texto = contenido.trim();
    // Antes se devolvía OK sin guardar nada: el que escribía solo espacios veía
    // su mensaje desaparecer sin explicación.
    if (!texto) throw new BadRequestException('Escribe un mensaje');
    const autorNombre = await this.resolveUsuarioNombre(autorId);
    const conversacion = await this.obtenerConversacionEscopeada(id, sistemaNegocio);

    const [, actualizada] = await this.prisma.$transaction([
      this.prisma.soporteMensaje.create({
        data: { conversacionId: id, rol: 'SISTEMA', autorNombre, contenido: texto },
      }),
      this.prisma.soporteConversacion.update({
        where: { id },
        data: {
          estado: 'ABIERTA',
          noLeidosEmpresa: { increment: 1 },
          asignadoAId: autorId,
          asignadoANombre: autorNombre,
        },
      }),
    ]);

    // Mismo criterio que del lado de la empresa: el mensaje ya está guardado.
    await this.notificarEmpresa(conversacion.empresaId, id, autorNombre, texto).catch(
      (error) =>
        this.logger.warn(
          `[soporte] no se pudo avisar a la empresa ${conversacion.empresaId}: ${error?.message}`,
        ),
    );
    return actualizada;
  }

  async cerrarConversacion(id: number, sistemaNegocio: string | null) {
    await this.obtenerConversacionEscopeada(id, sistemaNegocio);
    return this.prisma.soporteConversacion.update({
      where: { id },
      data: { estado: 'CERRADA' },
    });
  }

  private async resolveUsuarioNombre(usuarioId: number): Promise<string> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { nombre: true },
    });
    return usuario?.nombre ?? 'Usuario';
  }

  /** Notifica en vivo a los usuarios de la empresa (dueño + usuarios con acceso). */
  private async notificarEmpresa(
    empresaId: number,
    conversacionId: number,
    autorNombre: string,
    contenido: string,
  ) {
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        empresaId,
        rol: { in: ['ADMIN_EMPRESA', 'USUARIO_EMPRESA'] },
        estado: 'ACTIVO',
      },
      select: { id: true },
    });
    if (!usuarios.length) return;
    this.notificaciones.emitirEventoAUsuarios(
      usuarios.map((u) => u.id),
      'nuevo-mensaje-soporte',
      { conversacionId, empresaId, autorNombre, contenido, rol: 'SISTEMA' },
    );
  }
}
