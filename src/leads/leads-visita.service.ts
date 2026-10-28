import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { MensajeriaService } from './mensajeria.service';
import {
  fechaDeVisita,
  imagenesComoLlegar,
  LARGO_PIE_DE_FOTO,
  textoComoLlegar,
  tieneComoLlegar,
  tiendaValida,
} from './visita-tienda';

export type FiltroVisitas = 'proximas' | 'sin_fecha' | 'con_reserva' | 'pasadas' | 'todas';

const ESTADOS = ['AGENDADA', 'VINO', 'NO_VINO', 'CANCELADA'] as const;
type EstadoVisita = (typeof ESTADOS)[number];

/**
 * Visitas a la tienda física (ver visita-tienda.ts y el modelo
 * LeadVisitaTienda). Las registra el bot; el panel las lista para que el
 * negocio sepa a quién espera y quién reservó.
 */
@Injectable()
export class LeadsVisitaService {
  private readonly logger = new Logger(LeadsVisitaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mensajeria: MensajeriaService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  /**
   * Registra (o reagenda) la visita y, la primera vez, le manda al cliente
   * la ubicación, la foto y las indicaciones. Devuelve lo que el modelo
   * necesita para no repetir la dirección que ya le llegó.
   */
  async registrar(
    empresaId: number,
    conversacionId: number,
    telefono: string,
    datos: { cuando: string; fecha?: unknown; conPedido: boolean },
  ): Promise<{
    registrada: boolean;
    fecha: string | null;
    indicacionesEnviadas: boolean;
    yaTeniaIndicaciones: boolean;
    aviso?: string;
    /** Lo que se le notificó al negocio, para repetirlo por WhatsApp. */
    notificacion?: { titulo: string; mensaje: string };
  }> {
    const cuando = datos.cuando.trim().slice(0, 200) || null;
    const fecha = cuando ? fechaDeVisita(cuando, datos.fecha) : null;
    const [conv, borrador] = await Promise.all([
      this.prisma.leadConversacion.findUnique({
        where: { id: conversacionId },
        select: { nombreProspecto: true },
      }),
      this.prisma.leadPedidoBorrador.findUnique({
        where: { conversacionId },
        select: { nombre: true, comprobanteId: true, itemsJson: true },
      }),
    ]);
    const nombre = borrador?.nombre ?? conv?.nombreProspecto ?? null;
    const comprobanteId = datos.conPedido ? (borrador?.comprobanteId ?? null) : null;

    const antes = await this.prisma.leadVisitaTienda.findUnique({
      where: { conversacionId },
      select: { indicacionesEn: true, fecha: true, cuando: true, actualizadoEn: true },
    });
    const visita = await this.prisma.leadVisitaTienda.upsert({
      where: { conversacionId },
      create: {
        empresaId,
        conversacionId,
        telefono,
        nombre,
        cuando,
        fecha: fecha ? new Date(`${fecha}T00:00:00Z`) : null,
        comprobanteId,
      },
      update: {
        nombre,
        cuando,
        fecha: fecha ? new Date(`${fecha}T00:00:00Z`) : null,
        // Reagendar vuelve a dejarla pendiente: si antes "no vino", ahora sí
        // se lo espera.
        estado: 'AGENDADA',
        ...(comprobanteId ? { comprobanteId } : {}),
      },
      select: { id: true, indicacionesEn: true },
    });

    // La visita con pedido ya avisa a la tienda por su lado (avisarVisitaTienda).
    const cambioDeDia = antes && (antes.cuando ?? '') !== (cuando ?? '');
    let notificacion: { titulo: string; mensaje: string } | undefined;
    if (!datos.conPedido && (!antes || cambioDeDia)) {
      // Con productos cotizados viene a comprar, no a mirar (Hierba Sana,
      // 28-10: el aviso decía "viene a ver" de alguien que pidió los 2).
      const cotizado = await this.listaCotizada(empresaId, borrador?.itemsJson);
      notificacion = {
        titulo: `🏬 ${antes ? 'Cambió su visita' : 'Va a visitar la tienda'}: ${nombre ?? telefono}`,
        mensaje: [
          `${nombre ?? 'Un cliente'} dice que va a pasar por la tienda${cuando ? ` ${cuando}` : ''}.`,
          ...(cotizado
            ? [
                'Le interesa (cotizado, SIN pedido registrado ni stock apartado):',
                cotizado,
              ]
            : ['Todavía no hizo pedido: viene a ver o a consultar.']),
          `WhatsApp: ${telefono}`,
        ].join('\n'),
      };
      await this.notificaciones
        .notificarAdminsEmpresa({
          empresaId,
          tipo: 'INFO',
          ...notificacion,
          metaData: { origen: 'ia-ventas-visita-tienda', telefono, conversacionId },
        })
        .catch(() => undefined);
    }

    let indicacionesEnviadas = false;
    if (!visita.indicacionesEn) {
      indicacionesEnviadas = await this.enviarComoLlegar(empresaId, telefono);
      if (indicacionesEnviadas) {
        await this.prisma.leadVisitaTienda.update({
          where: { id: visita.id },
          data: { indicacionesEn: new Date() },
        });
      }
    }
    this.logger.log(
      `Lead: visita a tienda (empresa ${empresaId}, conv ${conversacionId}, ${fecha ?? 'sin fecha'}, indicaciones ${indicacionesEnviadas ? 'enviadas' : 'no'}).`,
    );
    const yaTeniaIndicaciones = !!visita.indicacionesEn;
    // Por WhatsApp no se repite cuando solo está completando la hora del
    // mismo día ("el viernes voy" → "2pm"): en QA llegaban dos mensajes en
    // un minuto. La campana sí se actualiza.
    const soloCompletaLaHora =
      !!antes &&
      (antes.fecha?.toISOString().slice(0, 10) ?? null) === fecha &&
      Date.now() - antes.actualizadoEn.getTime() < 30 * 60_000;
    return {
      registrada: true,
      fecha,
      indicacionesEnviadas,
      yaTeniaIndicaciones,
      ...(notificacion && !soloCompletaLaHora ? { notificacion } : {}),
      // QA 26-10: sin esto el modelo decía "te acabo de mandar la ubicación"
      // aunque no hubiera salido nada.
      ...(!indicacionesEnviadas && !yaTeniaIndicaciones
        ? {
            aviso:
              'NO se le mandó la ubicación ni la foto. No digas que se la enviaste: dale tú la dirección de la tienda que tienes en el contexto.',
          }
        : {}),
    };
  }

  /**
   * La víspera, a las 7 p. m.: "te esperamos mañana" con cómo llegar.
   *
   * La víspera y no la mañana: los avisos salen de 9 a 21 h y Hierba Sana
   * abre antes (Percy iba a las 8 a. m.); a las 9 ya habría llegado, o se
   * habría perdido. Solo dentro de las 24 h desde que el cliente escribió:
   * fuera de esa ventana WhatsApp exige plantilla, y en ese caso no se manda.
   */
  @Cron('0 19 * * *', { name: 'leads-visitas-recordatorio', timeZone: 'America/Lima' })
  async recordarVisitasDeManana(ahora = new Date()): Promise<void> {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(ahora);
    const manana = new Date(`${hoy}T00:00:00Z`);
    manana.setUTCDate(manana.getUTCDate() + 1);
    const visitas = await this.prisma.leadVisitaTienda.findMany({
      where: { estado: 'AGENDADA', fecha: manana, recordatorioEn: null },
      select: { id: true, empresaId: true, conversacionId: true, telefono: true, nombre: true },
      take: 200,
    });
    for (const v of visitas) {
      try {
        const [empresa, ultimoCliente] = await Promise.all([
          this.prisma.empresa.findUnique({
            where: { id: v.empresaId },
            select: { iaVentasActiva: true, iaVentasConfigJson: true, nombreComercial: true, razonSocial: true },
          }),
          this.prisma.leadMensaje.findFirst({
            where: { conversacionId: v.conversacionId, rol: 'USUARIO' },
            orderBy: { id: 'desc' },
            select: { creadoEn: true },
          }),
        ]);
        if (!empresa?.iaVentasActiva) continue;
        if (!ultimoCliente || ahora.getTime() - ultimoCliente.creadoEn.getTime() >= 24 * 3600_000) {
          this.logger.log(`Visita ${v.id}: sin recordatorio, fuera de la ventana de 24 h.`);
          continue;
        }
        const tienda = tiendaValida((empresa.iaVentasConfigJson as { tienda?: unknown } | null)?.tienda);
        if (!tieneComoLlegar(tienda)) continue;
        const negocio = empresa.nombreComercial || empresa.razonSocial;
        const saludo = `¡Hola${v.nombre ? ` ${v.nombre.split(' ')[0]}` : ''}! Te esperamos mañana en ${negocio} 🌿`;
        const texto = `${saludo}\n\n${textoComoLlegar(tienda, negocio)}`;
        if (tienda.lat != null && tienda.lng != null) {
          await this.mensajeria.enviarUbicacion(
            v.telefono,
            { lat: tienda.lat, lng: tienda.lng, nombre: negocio, direccion: tienda.direccion || undefined },
            v.empresaId,
          );
        }
        const r = await this.mensajeria.enviarTexto(v.telefono, texto, v.empresaId);
        if (!r.success) {
          this.logger.warn(`Visita ${v.id}: recordatorio no salió: ${r.error}`);
          continue;
        }
        await this.prisma.leadMensaje.create({
          data: { conversacionId: v.conversacionId, rol: 'ASISTENTE', contenido: texto },
        });
        await this.prisma.leadVisitaTienda.update({ where: { id: v.id }, data: { recordatorioEn: new Date() } });
      } catch (e: any) {
        this.logger.warn(`Visita ${v.id}: error en el recordatorio: ${e?.message}`);
      }
    }
  }

  /**
   * Mapa, croquis y foto, y las indicaciones. Con una sola imagen y un texto
   * corto, el texto va de pie de foto; si no, las imágenes primero y el texto
   * al final, que es lo que el cliente lee. True si salió algo.
   */
  /** "• 1x Producto" por línea de lo cotizado; null si no hay nada. */
  private async listaCotizada(empresaId: number, itemsJson: unknown): Promise<string | null> {
    const items = (Array.isArray(itemsJson) ? itemsJson : []) as {
      productoId?: number;
      cantidad?: number;
    }[];
    const validos = items.filter((i) => Number(i?.productoId) > 0);
    if (validos.length === 0) return null;
    const productos = await this.prisma.producto
      .findMany({
        where: { empresaId, id: { in: validos.map((i) => Number(i.productoId)) } },
        select: { id: true, descripcion: true },
      })
      .catch(() => [] as { id: number; descripcion: string }[]);
    return validos
      .map((i) => {
        const p = productos.find((x) => x.id === Number(i.productoId));
        return `• ${i.cantidad ?? 1}x ${p?.descripcion ?? `producto ${i.productoId}`}`;
      })
      .join('\n');
  }

  private async enviarComoLlegar(empresaId: number, telefono: string): Promise<boolean> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { iaVentasConfigJson: true, nombreComercial: true, razonSocial: true },
    });
    const tienda = tiendaValida((empresa?.iaVentasConfigJson as { tienda?: unknown } | null)?.tienda);
    if (!tieneComoLlegar(tienda)) return false;
    const negocio = empresa?.nombreComercial || empresa?.razonSocial || 'la tienda';

    let salio = false;
    if (tienda.lat != null && tienda.lng != null) {
      const r = await this.mensajeria.enviarUbicacion(
        telefono,
        { lat: tienda.lat, lng: tienda.lng, nombre: negocio, direccion: tienda.direccion || undefined },
        empresaId,
      );
      salio ||= r.success;
    }
    const texto = textoComoLlegar(tienda, negocio);
    const imagenes = imagenesComoLlegar(tienda);
    const conPie = imagenes.length === 1 && texto.length <= LARGO_PIE_DE_FOTO;
    for (const url of conPie ? [] : imagenes) {
      const img = await this.mensajeria.enviarImagenUrl(telefono, url, undefined, empresaId);
      salio ||= img.success;
      if (!img.success) this.logger.warn(`Visita: no salió una imagen a ${telefono}: ${img.error}`);
    }
    const r = conPie
      ? await this.mensajeria.enviarImagenUrl(telefono, imagenes[0], texto, empresaId)
      : await this.mensajeria.enviarTexto(telefono, texto, empresaId);
    salio ||= r.success;
    if (!r.success) this.logger.warn(`Visita: no salieron las indicaciones a ${telefono}: ${r.error}`);
    return salio;
  }

  /** La lista del panel, con si dejó reserva (voucher) y su resumen. */
  async listar(empresaId: number, filtro: FiltroVisitas = 'proximas') {
    const hoy = new Date(
      `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())}T00:00:00Z`,
    );
    const where: Record<string, unknown> = { empresaId };
    if (filtro === 'proximas') Object.assign(where, { estado: 'AGENDADA', fecha: { gte: hoy } });
    if (filtro === 'sin_fecha') Object.assign(where, { estado: 'AGENDADA', fecha: null });
    if (filtro === 'pasadas') Object.assign(where, { fecha: { lt: hoy } });

    const visitas = await this.prisma.leadVisitaTienda.findMany({
      where: where as never,
      orderBy: filtro === 'pasadas' ? [{ fecha: 'desc' }] : [{ fecha: 'asc' }, { creadoEn: 'desc' }],
      take: 300,
      include: {
        conversacion: {
          select: {
            prospecto: {
              select: {
                resumen: true,
                etapa: true,
                comprobantesPago: {
                  where: { rechazadoEn: null },
                  select: { montoLeido: true, validadoEn: true, recibidoEn: true },
                  orderBy: { recibidoEn: 'desc' },
                  take: 3,
                },
              },
            },
          },
        },
      },
    });

    const filas = visitas.map((v) => {
      // Solo cuentan los pagos de esta visita, no los de una compra anterior.
      const desde = v.creadoEn.getTime() - 2 * 86_400_000;
      const pagos = (v.conversacion?.prospecto?.comprobantesPago ?? []).filter(
        (p) => p.recibidoEn.getTime() >= desde,
      );
      const reserva = pagos.length
        ? {
            monto: pagos.reduce((s, p) => s + Number(p.montoLeido ?? 0), 0),
            validada: pagos.some((p) => p.validadoEn != null),
          }
        : null;
      return {
        id: v.id,
        conversacionId: v.conversacionId,
        telefono: v.telefono,
        nombre: v.nombre,
        cuando: v.cuando,
        fecha: v.fecha ? v.fecha.toISOString().slice(0, 10) : null,
        estado: v.estado,
        conPedido: v.comprobanteId != null,
        comprobanteId: v.comprobanteId,
        reserva,
        indicacionesEnviadas: v.indicacionesEn != null,
        resumen: v.conversacion?.prospecto?.resumen ?? null,
        creadoEn: v.creadoEn,
      };
    });
    return filtro === 'con_reserva' ? filas.filter((f) => f.reserva) : filas;
  }

  /** El negocio marca si vino o no. */
  async marcar(empresaId: number, id: number, estado: string) {
    if (!ESTADOS.includes(estado as EstadoVisita)) {
      throw new BadRequestException('Estado de visita inválido');
    }
    const v = await this.prisma.leadVisitaTienda.findFirst({ where: { id, empresaId }, select: { id: true } });
    if (!v) throw new NotFoundException('Visita no encontrada');
    return this.prisma.leadVisitaTienda.update({
      where: { id },
      data: { estado: estado as EstadoVisita },
      select: { id: true, estado: true },
    });
  }

  /** Reenvía la ubicación y las indicaciones (botón del panel). */
  async reenviarComoLlegar(empresaId: number, id: number) {
    const v = await this.prisma.leadVisitaTienda.findFirst({
      where: { id, empresaId },
      select: { id: true, telefono: true },
    });
    if (!v) throw new NotFoundException('Visita no encontrada');
    const ok = await this.enviarComoLlegar(empresaId, v.telefono);
    if (!ok) {
      throw new BadRequestException(
        'No se pudo enviar: revisa que la tienda tenga ubicación, foto o indicaciones en Mi vendedor → Entrega, y que el cliente haya escrito en las últimas 24 h.',
      );
    }
    await this.prisma.leadVisitaTienda.update({ where: { id }, data: { indicacionesEn: new Date() } });
    return { enviado: true };
  }
}
