import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { NOMBRE_DEL_BOT, SoporteBotService } from './soporte-bot.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { empresaKrezkaId } from '../leads/reporte-diario';
import { debeAvisar, telefonosDeAviso, textoDeAviso } from './soporte-aviso';
import { S3Service } from '../s3/s3.service';
import { aOggOpus, tieneAudio } from '../leads/nota-de-voz';
import sharp from 'sharp';

/** Archivo que llega por multipart. */
export interface ArchivoSoporte {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** Lo que acompaña al texto de un mensaje: una foto o una nota de voz. */
interface Adjunto {
  imagenUrl?: string;
  audioUrl?: string;
}

const LIMITE_IMAGEN = 10 * 1024 * 1024;
const LIMITE_AUDIO = 16 * 1024 * 1024;

/** Con qué nombre se presenta el asistente ante el empresario. */
const MARCA_SOPORTE = 'Krezka';

/**
 * El horario que el asistente puede citar.
 *
 * Es el mismo texto que muestra el widget (frontend, `soporteHorario.ts`). Si
 * cambia uno y no el otro, el bot promete una atención distinta de la que
 * anuncia la pantalla.
 */
const HORARIO_SOPORTE =
  'Lunes a viernes de 9:00 a 6:00 p.m., sábados de 9:00 a 1:00 p.m. Domingos no se atiende. ' +
  'Lo que se pide se sube al cierre del día; como máximo, la noche siguiente.';

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
    private readonly bot: SoporteBotService,
    // Al final y opcional: los specs arman el servicio con los tres de arriba.
    @Optional() private readonly whatsapp?: WhatsAppService,
    @Optional() private readonly s3?: S3Service,
  ) {}

  // ── Fotos y notas de voz ──────────────────────────────────────────────────

  /**
   * Sube la foto o la nota de voz y devuelve el adjunto con su texto para la
   * bandeja. La foto va a JPG (las de celular llegan en HEIC, WEBP o giradas)
   * y la voz a OGG/Opus, igual que en el chat de IA de Ventas.
   */
  private async subirAdjunto(
    empresaId: number,
    tipo: 'imagen' | 'audio',
    archivo: ArchivoSoporte | undefined,
    pie?: string,
  ): Promise<{ adjunto: Adjunto; contenido: string }> {
    if (!this.s3) throw new BadRequestException('El almacenamiento no está disponible.');
    if (!archivo?.buffer?.length) {
      throw new BadRequestException(tipo === 'imagen' ? 'Falta la imagen.' : 'Falta el audio.');
    }
    const base = `soporte/empresa-${empresaId}/${Date.now()}`;
    const texto = (pie ?? '').trim().slice(0, 1000);
    if (tipo === 'imagen') {
      if (!/^image\//.test(archivo.mimetype)) throw new BadRequestException('El archivo tiene que ser una imagen.');
      if (archivo.size > LIMITE_IMAGEN) throw new BadRequestException('La imagen pesa más de 10 MB.');
      let jpg: Buffer;
      try {
        jpg = await sharp(archivo.buffer)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch {
        throw new BadRequestException('No se pudo leer la imagen. Prueba con una foto JPG o PNG.');
      }
      const url = await this.s3.uploadPDF(jpg, `${base}.jpg`, 'image/jpeg');
      return { adjunto: { imagenUrl: url }, contenido: texto ? `[Imagen] ${texto}` : '[Imagen]' };
    }
    // Algunos navegadores mandan la grabación como video/webm (sin imagen).
    if (!/^(audio\/|video\/webm)/.test(archivo.mimetype)) throw new BadRequestException('El archivo tiene que ser un audio.');
    if (archivo.size > LIMITE_AUDIO) throw new BadRequestException('El audio pesa más de 16 MB.');
    let ogg: Buffer;
    try {
      ogg = await aOggOpus(archivo.buffer);
    } catch {
      throw new BadRequestException('No se pudo leer el audio. Vuelve a grabarlo.');
    }
    if (!tieneAudio(ogg)) {
      throw new BadRequestException('La grabación salió sin sonido. Revisa el micrófono y vuelve a grabarla.');
    }
    const url = await this.s3.uploadPDF(ogg, `${base}.ogg`, 'audio/ogg');
    return { adjunto: { audioUrl: url }, contenido: '[Nota de voz]' };
  }

  async enviarAdjuntoEmpresa(
    empresaId: number,
    usuarioId: number,
    tipo: 'imagen' | 'audio',
    archivo: ArchivoSoporte | undefined,
    pie?: string,
  ) {
    const { adjunto, contenido } = await this.subirAdjunto(empresaId, tipo, archivo, pie);
    return this.enviarMensajeEmpresa(empresaId, usuarioId, contenido, adjunto);
  }

  async enviarAdjuntoSistema(
    id: number,
    sistemaNegocio: string | null,
    autorId: number,
    tipo: 'imagen' | 'audio',
    archivo: ArchivoSoporte | undefined,
    pie?: string,
  ) {
    const conversacion = await this.obtenerConversacionEscopeada(id, sistemaNegocio);
    const { adjunto, contenido } = await this.subirAdjunto(conversacion.empresaId, tipo, archivo, pie);
    return this.enviarMensajeSistema(id, sistemaNegocio, autorId, contenido, adjunto);
  }

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
    adjunto: Adjunto = {},
  ) {
    const texto = contenido.trim();
    // Antes se devolvía OK sin guardar nada: el que escribía solo espacios veía
    // su mensaje desaparecer sin explicación.
    if (!texto) throw new BadRequestException('Escribe un mensaje');

    const autorNombre = await this.resolveUsuarioNombre(usuarioId);
    const conversacion = await this.obtenerOCrearConversacion(empresaId);
    const [mensaje, actualizada] = await this.prisma.$transaction([
      this.prisma.soporteMensaje.create({
        data: {
          conversacionId: conversacion.id,
          rol: 'EMPRESA',
          autorNombre,
          contenido: texto,
          ...adjunto,
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
    await this.notificarSistema(empresaId, actualizada.id, mensaje.id, autorNombre, texto, adjunto).catch(
      (error) =>
        this.logger.warn(
          `[soporte] no se pudo avisar a Krezka del mensaje de la empresa ${empresaId}: ${error?.message}`,
        ),
    );

    // Y al celular del equipo, si es el primer mensaje sin leer y estamos en
    // horario (ver soporte-aviso.ts). Mismo trato: nunca tumba el envío.
    if (debeAvisar(actualizada.noLeidosSistema)) {
      await this.avisarPorWhatsapp(empresaId, autorNombre, texto).catch((error) =>
        this.logger.warn(
          `[soporte] no se pudo avisar por WhatsApp del mensaje de la empresa ${empresaId}: ${error?.message}`,
        ),
      );
    }

    // El asistente contesta si le toca. Va al final y sin dejar subir el error
    // por el mismo motivo que el aviso: el mensaje del empresario ya está
    // guardado, y que la IA falle no puede hacerle ver un fallo y reintentar.
    // Una foto o una voz no las lee: que las vea una persona.
    if (!adjunto.imagenUrl && !adjunto.audioUrl) {
      await this.responderConAsistente(actualizada.id, empresaId, texto).catch(
        (error) =>
          this.logger.warn(
            `[soporte] el asistente no pudo responder a la empresa ${empresaId}: ${error?.message}`,
          ),
      );
    }
    return actualizada;
  }

  /**
   * Deja que el asistente conteste, si corresponde.
   *
   * El mensaje se guarda como SISTEMA igual que el de una persona, pero SIN
   * asignar la conversación: asignarla la marcaría como tomada y el propio bot
   * se callaría para siempre en ese hilo. Además, una conversación asignada al
   * bot le escondería al equipo que nadie la atendió de verdad.
   */
  private async responderConAsistente(
    conversacionId: number,
    empresaId: number,
    texto: string,
  ): Promise<void> {
    const respuesta = await this.bot.responder({
      conversacionId,
      mensaje: texto,
      marca: MARCA_SOPORTE,
      horario: HORARIO_SOPORTE,
    });
    // null es la mitad del diseño: le toca a una persona y no pasa nada más.
    if (!respuesta) return;

    const [mensaje] = await this.prisma.$transaction([
      this.prisma.soporteMensaje.create({
        data: {
          conversacionId,
          rol: 'SISTEMA',
          autorNombre: NOMBRE_DEL_BOT,
          contenido: respuesta,
        },
      }),
      this.prisma.soporteConversacion.update({
        where: { id: conversacionId },
        data: { noLeidosEmpresa: { increment: 1 } },
      }),
    ]);

    await this.notificarEmpresa(
      empresaId,
      conversacionId,
      mensaje.id,
      NOMBRE_DEL_BOT,
      respuesta,
    ).catch((error) =>
      this.logger.warn(
        `[soporte] no se pudo entregar la respuesta del asistente a la empresa ${empresaId}: ${error?.message}`,
      ),
    );
  }

  /**
   * Aviso al celular del equipo desde el número de Krezka. Primero texto libre
   * (llega si ese número le escribió a Krezka en las últimas 24 h) y, si
   * WhatsApp lo rechaza, la plantilla `aviso_equipo`, que llega siempre.
   */
  private async avisarPorWhatsapp(empresaId: number, autorNombre: string, contenido: string) {
    const destinos = telefonosDeAviso(process.env.SOPORTE_AVISO_TELEFONOS);
    if (!this.whatsapp || destinos.length === 0) return;
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { nombreComercial: true, razonSocial: true },
    });
    const nombre = empresa?.nombreComercial || empresa?.razonSocial || `Empresa ${empresaId}`;
    const panel = (process.env.FRONTEND_URL || 'https://app.krezka.com').split(',')[0].replace(/\/$/, '');
    const texto = textoDeAviso(nombre, autorNombre, contenido, panel);
    const krezka = empresaKrezkaId();
    await Promise.allSettled(
      destinos.map(async (numero) => {
        const r = await this.whatsapp!.enviarTexto(numero, texto, krezka);
        if (r.success) return;
        const p = await this.whatsapp!.enviarPlantilla(
          numero,
          'aviso_equipo',
          'es',
          [`Mensaje de soporte de ${nombre}`.slice(0, 200), autorNombre.slice(0, 100)],
          krezka,
        );
        if (!p.success) this.logger.warn(`[soporte] aviso a ${numero}: falló texto (${r.error}) y plantilla (${p.error}).`);
      }),
    );
  }

  /** Notifica en vivo a los ADMIN_SISTEMA del brand de la empresa (o sin brand = todos). */
  private async notificarSistema(
    empresaId: number,
    conversacionId: number,
    mensajeId: number,
    autorNombre: string,
    contenido: string,
    adjunto: Adjunto = {},
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
        // El id real del mensaje: sin él, quien lo recibe no puede distinguir
        // un mensaje nuevo de uno que ya tiene, y un evento repetido
        // (reconexión, dos pestañas) lo muestra duplicado.
        mensajeId,
        empresaNombre: empresa?.nombreComercial || empresa?.razonSocial,
        autorNombre,
        contenido,
        ...adjunto,
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
    adjunto: Adjunto = {},
  ) {
    const texto = contenido.trim();
    // Antes se devolvía OK sin guardar nada: el que escribía solo espacios veía
    // su mensaje desaparecer sin explicación.
    if (!texto) throw new BadRequestException('Escribe un mensaje');
    const autorNombre = await this.resolveUsuarioNombre(autorId);
    const conversacion = await this.obtenerConversacionEscopeada(id, sistemaNegocio);

    const [mensaje, actualizada] = await this.prisma.$transaction([
      this.prisma.soporteMensaje.create({
        data: { conversacionId: id, rol: 'SISTEMA', autorNombre, contenido: texto, ...adjunto },
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
    await this.notificarEmpresa(conversacion.empresaId, id, mensaje.id, autorNombre, texto, adjunto).catch(
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
    mensajeId: number,
    autorNombre: string,
    contenido: string,
    adjunto: Adjunto = {},
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
      // El id real del mensaje viaja en el aviso: sin él, quien lo recibe no
      // puede distinguir un mensaje nuevo de uno que ya tiene, y un evento
      // repetido (reconexión, dos pestañas) lo muestra duplicado.
      { conversacionId, empresaId, mensajeId, autorNombre, contenido, ...adjunto, rol: 'SISTEMA' },
    );
  }
}
