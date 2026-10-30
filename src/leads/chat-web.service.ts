import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_INGRESAR_MENSAJE, LEADS_MESSAGES_QUEUE } from './leads.constants';
import { estaPausado } from './pausa-bot';
import {
  LIMITES,
  Limitador,
  PREFIJO_WEB,
  armarHistorial,
  contextoDeProducto,
  estaEscribiendo,
  sesionValida,
  textoValido,
} from './chat-web';

/**
 * Chat de la tienda online (ver chat-web.ts).
 *
 * Dos lados:
 *  - Entrada (público): el mensaje del cliente entra a la MISMA cola que los
 *    de WhatsApp, así pasa por todo lo de siempre: catálogo, herramientas,
 *    pausa cuando atiende una persona, tope de leads del plan, bandeja.
 *  - Salida: ver ChatWebSalidaService.
 */
@Injectable()
export class ChatWebService {
  private readonly limitador = new Limitador();

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(LEADS_MESSAGES_QUEUE) private readonly queue: Queue,
  ) {}

  // ─── Entrada (público) ────────────────────────────────────────────────────

  /** La tienda con el chat encendido, o error. */
  private async tiendaConChat(slug: string) {
    const empresa = await this.prisma.empresa.findFirst({
      where: { slugTienda: slug },
      select: { id: true, iaVentasActiva: true, iaVentasConfigJson: true },
    });
    if (!empresa) throw new NotFoundException('Tienda no encontrada');
    const json = (empresa.iaVentasConfigJson ?? {}) as Record<string, unknown>;
    if (!empresa.iaVentasActiva || json.chatTienda !== true) {
      throw new BadRequestException('El chat de esta tienda no está disponible.');
    }
    return empresa;
  }

  async enviar(
    slug: string,
    body: { sesion?: unknown; texto?: unknown; productoId?: unknown; nombre?: unknown },
    ip: string,
  ) {
    const sesion = sesionValida(body?.sesion);
    const texto = textoValido(body?.texto);
    if (!sesion) throw new BadRequestException('Sesión inválida.');
    if (!texto) throw new BadRequestException('Escribe un mensaje.');
    const empresa = await this.tiendaConChat(slug);

    if (
      !this.limitador.permitir(`s:${sesion}`, LIMITES.porSesionMinuto, 60_000) ||
      !this.limitador.permitir(`ip:${ip}`, LIMITES.porIpMinuto, 60_000) ||
      !this.limitador.permitir(`d:${sesion}`, LIMITES.porSesionDia, 24 * 3600_000)
    ) {
      throw new HttpException('Estás escribiendo muy rápido. Espera un momento.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const productoId = Number(body?.productoId);
    const producto =
      Number.isInteger(productoId) && productoId > 0
        ? await this.prisma.producto.findFirst({
            where: { id: productoId, empresaId: empresa.id },
            select: { descripcion: true, precioUnitario: true, moneda: true },
          })
        : null;
    const nombre = String(body?.nombre ?? '').trim().slice(0, 60) || undefined;

    const clienteId = randomUUID();
    const messageId = `${PREFIJO_WEB}${sesion}:${clienteId}`;
    await this.queue.add(
      JOB_INGRESAR_MENSAJE,
      {
        canal: 'WEB',
        empresaId: empresa.id,
        from: `${PREFIJO_WEB}${sesion}`,
        messageId,
        text: texto,
        esAudio: false,
        ...(nombre ? { nombre } : {}),
        ...(producto ? { contexto: contextoDeProducto(producto) } : {}),
        timestamp: String(Math.floor(Date.now() / 1000)),
      },
      {
        // BullMQ no acepta ":" en el id.
        jobId: `in-${messageId.replace(/:/g, '-')}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    return { clienteId };
  }

  async mensajes(slug: string, sesionCruda: unknown) {
    const sesion = sesionValida(sesionCruda);
    if (!sesion) throw new BadRequestException('Sesión inválida.');
    const empresa = await this.tiendaConChat(slug);
    const conv = await this.prisma.leadConversacion.findUnique({
      where: { empresaId_telefonoProspecto: { empresaId: empresa.id, telefonoProspecto: `${PREFIJO_WEB}${sesion}` } },
      select: { id: true, botActivo: true, pausadoHasta: true },
    });
    if (!conv) return { mensajes: [], escribiendo: false, atiendePersona: false };

    const [usuario, salidas, ultimaRespuesta] = await Promise.all([
      this.prisma.leadMensaje.findMany({
        where: { conversacionId: conv.id, rol: 'USUARIO' as never },
        orderBy: { id: 'asc' },
        take: 200,
        select: { id: true, contenido: true, whatsappMsgId: true, creadoEn: true },
      }),
      this.prisma.leadWebSalida.findMany({
        where: { conversacionId: conv.id },
        orderBy: { id: 'asc' },
        take: 200,
        select: { id: true, tipo: true, texto: true, url: true, productoId: true, opcionesJson: true, creadoEn: true },
      }),
      this.prisma.leadMensaje.findFirst({
        where: { conversacionId: conv.id, rol: { not: 'USUARIO' as never } },
        orderBy: { id: 'desc' },
        select: { creadoEn: true },
      }),
    ]);
    const historial = armarHistorial(usuario, salidas);
    const atiendePersona = estaPausado(conv);
    return {
      mensajes: historial,
      escribiendo: estaEscribiendo(
        usuario.length ? usuario[usuario.length - 1].creadoEn : null,
        ultimaRespuesta?.creadoEn ?? null,
        !atiendePersona,
      ),
      atiendePersona,
    };
  }
}
