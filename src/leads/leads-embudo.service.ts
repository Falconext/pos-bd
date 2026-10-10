import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { etiquetaDeUsuario, nombreDeUsuario } from '../common/utils/nombre-usuario.util';
import {
  Actor,
  EtapaCrm,
  ETIQUETA_ETAPA,
  ORDEN_EMBUDO,
  DESVIOS,
  esAvance,
  etapaDesdeDespacho,
  puedeMover,
} from './leads-embudo';

/**
 * E1 — el embudo CRM y el candado de pago.
 *
 * Todos los movimientos pasan por acá: los automáticos (el bot cotizó, el
 * cliente mandó el voucher, la logística despachó) y los manuales. Así hay un
 * solo sitio donde se decide si un movimiento vale, y un solo sitio que deja
 * el rastro de quién lo hizo.
 */
@Injectable()
export class LeadsEmbudoService {
  private readonly logger = new Logger(LeadsEmbudoService.name);

  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
  ) {}

  /**
   * Mueve el pedido de etapa.
   *
   * `usuario` presente = lo movió una persona. Es lo que habilita las etapas
   * con candado, así que no se puede inventar desde el bot: el processor
   * llama siempre sin usuario.
   */
  async mover(
    prospectoId: number,
    empresaId: number,
    hacia: EtapaCrm,
    opciones: {
      usuario?: { id?: number; nombre?: string };
      nota?: string;
      /** Para los automatismos: no mover si sería un retroceso. */
      soloSiAvanza?: boolean;
    } = {},
  ) {
    const prospecto = await this.prisma.leadProspecto.findFirst({
      where: { id: prospectoId, empresaId },
      select: { id: true, etapa: true, conversacionId: true },
    });
    if (!prospecto) throw new NotFoundException('Prospecto no encontrado.');

    const desde = prospecto.etapa as unknown as EtapaCrm;
    // Lo que decide si es humano es que venga un usuario, NO que venga su
    // nombre: el token no trae nombre y confundir las dos cosas convertía
    // cada clic del encargado en un movimiento "del bot" en la auditoría.
    const actor: Actor = opciones.usuario ? 'humano' : 'bot';

    if (desde === hacia) return { movido: false, etapa: desde };

    if (opciones.soloSiAvanza && !esAvance(desde, hacia)) {
      return { movido: false, etapa: desde, motivo: 'sería un retroceso' };
    }

    const veredicto = puedeMover(desde, hacia, actor);
    if (!veredicto.permitido) {
      // Un automatismo que no puede mover no es un error: simplemente no
      // mueve. Un clic de una persona sí tiene que enterarse de por qué no.
      if (actor === 'bot') {
        return { movido: false, etapa: desde, motivo: veredicto.motivo };
      }
      throw new BadRequestException(veredicto.motivo);
    }

    // Pasar a despacho exige que el pago esté validado, cuando hubo voucher.
    if (hacia === EtapaCrm.POR_DESPACHAR) {
      await this.exigirPagoValidado(prospectoId);
    }

    const [actualizado] = await this.prisma.$transaction([
      this.prisma.leadProspecto.update({
        where: { id: prospectoId },
        data: { etapa: hacia as never, etapaEn: new Date() },
        select: { id: true, etapa: true, etapaEn: true },
      }),
      this.prisma.leadEtapaHistorial.create({
        data: {
          prospectoId,
          empresaId,
          desde: desde as never,
          hacia: hacia as never,
          actor: opciones.usuario
            ? etiquetaDeUsuario(
                opciones.usuario.nombre ??
                  (await nombreDeUsuario(this.prisma, opciones.usuario.id)),
                opciones.usuario.id,
              )
            : 'bot',
          usuarioId: opciones.usuario?.id ?? null,
          nota: opciones.nota ?? null,
        },
      }),
    ]);

    return { movido: true, etapa: actualizado.etapa, desde };
  }

  /**
   * Si el cliente mandó un voucher, alguien tiene que haberlo mirado.
   *
   * El candado del anexo no es solo "que lo mueva una persona": es que esa
   * persona haya VALIDADO el pago. Un voucher recibido y nunca revisado con
   * el pedido ya en despacho es exactamente el agujero que esto cierra.
   */
  private async exigirPagoValidado(prospectoId: number) {
    const pendientes = await this.prisma.leadComprobantePago.count({
      where: { prospectoId, validadoEn: null, rechazadoEn: null },
    });
    if (pendientes > 0) {
      throw new BadRequestException(
        pendientes === 1
          ? 'El cliente mandó un comprobante de pago que todavía nadie revisó.'
          : `Hay ${pendientes} comprobantes de pago sin revisar.`,
      );
    }
  }

  /**
   * El cliente mandó una imagen y la conversación tiene un pedido en curso:
   * se guarda como comprobante y el pedido queda esperando validación.
   *
   * La imagen se baja de WhatsApp porque validar sin ver el voucher no es
   * validar. Si la descarga falla, el comprobante se registra igual sin URL:
   * el cliente SÍ mandó algo y alguien tiene que mirarlo, aunque sea
   * abriendo el chat.
   */
  async registrarComprobantePago(
    empresaId: number,
    conversacionId: number,
    datos: { mediaId?: string; nota?: string; buffer?: Buffer; mimeType?: string },
  ) {
    const prospecto = await this.prisma.leadProspecto.findFirst({
      where: { conversacionId, empresaId },
      select: { id: true, etapa: true },
    });
    if (!prospecto) return { registrado: false };

    let url: string | null = null;
    if (datos.buffer && this.s3.isEnabled()) {
      try {
        const key = this.s3.generateComprobantePagoLeadKey(
          empresaId,
          conversacionId,
        );
        url = await this.s3.uploadImage(
          datos.buffer,
          key,
          datos.mimeType ?? 'image/jpeg',
        );
      } catch (e) {
        this.logger.warn(
          `No se pudo guardar el voucher de la conversación ${conversacionId}: ${(e as Error).message}`,
        );
      }
    }

    const pago = await this.prisma.leadComprobantePago.create({
      data: {
        empresaId,
        prospectoId: prospecto.id,
        conversacionId,
        url,
        mediaId: datos.mediaId ?? null,
        nota: datos.nota?.trim() || null,
      },
      select: { id: true, url: true },
    });

    await this.mover(prospecto.id, empresaId, EtapaCrm.PENDIENTE_VALIDACION_PAGO, {
      nota: 'El cliente envió un comprobante de pago',
    });

    return { registrado: true, pago };
  }

  /** El clic del encargado: el pago está bien. */
  async validarPago(
    pagoId: number,
    empresaId: number,
    usuario: { id?: number; nombre?: string },
    pasarADespacho = true,
  ) {
    const pago = await this.prisma.leadComprobantePago.findFirst({
      where: { id: pagoId, empresaId },
      select: { id: true, prospectoId: true, validadoEn: true },
    });
    if (!pago) throw new NotFoundException('Comprobante no encontrado.');
    if (pago.validadoEn) return { validado: true, yaEstaba: true };

    await this.prisma.leadComprobantePago.update({
      where: { id: pagoId },
      data: {
        validadoEn: new Date(),
        validadoPor: etiquetaDeUsuario(
          usuario.nombre ?? (await nombreDeUsuario(this.prisma, usuario.id)),
          usuario.id,
        ),
        validadoPorId: usuario.id ?? null,
        // Validar borra un rechazo anterior: el cliente pudo mandar el
        // voucher bueno después.
        rechazadoEn: null,
        rechazadoMotivo: null,
      },
    });

    let etapa: unknown = null;
    if (pasarADespacho) {
      etapa = await this.mover(
        pago.prospectoId,
        empresaId,
        EtapaCrm.POR_DESPACHAR,
        { usuario, nota: 'Pago validado' },
      );
    }
    return { validado: true, etapa };
  }

  /** El pago no cuadra: se rechaza con el motivo, para poder decírselo al cliente. */
  async rechazarPago(
    pagoId: number,
    empresaId: number,
    usuario: { id?: number; nombre?: string },
    motivo: string,
  ) {
    const limpio = motivo?.trim();
    if (!limpio) {
      // Un rechazo sin motivo deja al equipo sin saber qué pedirle al cliente.
      throw new BadRequestException('Indica por qué se rechaza el pago.');
    }
    const pago = await this.prisma.leadComprobantePago.findFirst({
      where: { id: pagoId, empresaId },
      select: { id: true },
    });
    if (!pago) throw new NotFoundException('Comprobante no encontrado.');

    await this.prisma.leadComprobantePago.update({
      where: { id: pagoId },
      data: {
        rechazadoEn: new Date(),
        rechazadoMotivo: limpio,
        validadoEn: null,
        validadoPor: etiquetaDeUsuario(
          usuario.nombre ?? (await nombreDeUsuario(this.prisma, usuario.id)),
          usuario.id,
        ),
        validadoPorId: usuario.id ?? null,
      },
    });
    return { rechazado: true };
  }

  /** Sigue al despacho: cuando la logística avanza, el embudo no se queda atrás. */
  async sincronizarConDespacho(
    empresaId: number,
    comprobanteId: number,
    estadoDespacho: string,
  ) {
    const hacia = etapaDesdeDespacho(estadoDespacho);
    if (!hacia) return { movido: false };

    const borrador = await this.prisma.leadPedidoBorrador.findFirst({
      where: { comprobanteId, empresaId },
      select: { conversacionId: true },
    });
    if (!borrador) return { movido: false };

    const prospecto = await this.prisma.leadProspecto.findFirst({
      where: { conversacionId: borrador.conversacionId, empresaId },
      select: { id: true },
    });
    if (!prospecto) return { movido: false };

    // REPROGRAMADO tiene candado humano, y acá el actor es la logística: se
    // registra igual porque la devolución la reportó una persona del equipo.
    return this.mover(prospecto.id, empresaId, hacia, {
      usuario: { nombre: 'logística' },
      nota: `Despacho en ${estadoDespacho}`,
    });
  }

  /**
   * El tablero: cuántos pedidos hay en cada etapa y cuáles son.
   *
   * Devuelve las 12 columnas siempre, incluso vacías: un embudo al que le
   * faltan columnas según el día no se puede leer de un vistazo.
   */
  async tablero(empresaId: number, limitePorEtapa = 20) {
    const [conteos, pagosPendientes] = await Promise.all([
      this.prisma.leadProspecto.groupBy({
        by: ['etapa'],
        where: { empresaId },
        _count: { _all: true },
      }),
      this.prisma.leadComprobantePago.count({
        where: { empresaId, validadoEn: null, rechazadoEn: null },
      }),
    ]);

    const porEtapa = new Map(
      conteos.map((c) => [String(c.etapa), c._count._all]),
    );

    const columnas = await Promise.all(
      [...ORDEN_EMBUDO, ...DESVIOS].map(async (etapa) => ({
        etapa,
        etiqueta: ETIQUETA_ETAPA[etapa],
        total: porEtapa.get(etapa) ?? 0,
        pedidos: await this.prisma.leadProspecto.findMany({
          where: { empresaId, etapa: etapa as never },
          orderBy: { etapaEn: 'desc' },
          take: limitePorEtapa,
          select: {
            id: true,
            telefonoProspecto: true,
            nombreProspecto: true,
            etapaEn: true,
            puntaje: true,
            estado: true,
            conversacion: { select: { id: true } },
            comprobantesPago: {
              where: { validadoEn: null, rechazadoEn: null },
              select: { id: true, url: true, recibidoEn: true },
            },
          },
        }),
      })),
    );

    return {
      // Lo primero que el encargado tiene que ver: cuántos pagos lo esperan.
      pagosPorValidar: pagosPendientes,
      columnas,
    };
  }

  /** El rastro de un pedido: por dónde pasó y quién lo movió. */
  async historial(prospectoId: number, empresaId: number) {
    return this.prisma.leadEtapaHistorial.findMany({
      where: { prospectoId, empresaId },
      orderBy: { creadoEn: 'asc' },
      select: {
        desde: true,
        hacia: true,
        actor: true,
        nota: true,
        creadoEn: true,
      },
    });
  }
}
