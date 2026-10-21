import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { PagoService } from '../pago/pago.service';
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
    @Optional() private pagos?: PagoService,
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
    datos: {
      mediaId?: string;
      nota?: string;
      buffer?: Buffer;
      mimeType?: string;
      /// Lo que la IA leyó de la imagen, si se pudo. Opcional a propósito.
      leido?: {
        monto: number | null;
        numeroOperacion: string | null;
        fecha: string | null;
        medio: string | null;
        pagador: string | null;
      } | null;
    },
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
        // La constancia de una transferencia suele llegar en PDF: se guarda
        // tal cual, porque pasarla por el conversor de imágenes la rompe.
        url =
          datos.mimeType === 'application/pdf'
            ? await this.s3.uploadPDF(
                datos.buffer,
                key.replace(/\.webp$/, '.pdf'),
              )
            : await this.s3.uploadImage(
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
        ...(datos.leido
          ? {
              montoLeido: datos.leido.monto ?? null,
              operacionLeida: datos.leido.numeroOperacion,
              fechaLeida: datos.leido.fecha,
              medioLeido: datos.leido.medio,
              pagadorLeido: datos.leido.pagador,
              leidoEn: new Date(),
            }
          : {}),
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
    montoConfirmado?: number,
  ) {
    const pago = await this.prisma.leadComprobantePago.findFirst({
      where: { id: pagoId, empresaId },
      select: {
        id: true,
        prospectoId: true,
        conversacionId: true,
        validadoEn: true,
        montoLeido: true,
        medioLeido: true,
        operacionLeida: true,
        recibidoEn: true,
      },
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

    const adelanto = await this.registrarAdelanto(
      empresaId,
      pago,
      montoConfirmado,
      usuario.id,
    );

    let etapa: unknown = null;
    if (pasarADespacho) {
      etapa = await this.mover(
        pago.prospectoId,
        empresaId,
        EtapaCrm.POR_DESPACHAR,
        { usuario, nota: 'Pago validado' },
      );
    }
    return { validado: true, etapa, adelanto };
  }

  /**
   * El voucher validado es dinero que entró: se registra como pago de la
   * nota del pedido y se descuenta de lo que queda por cobrar en la entrega.
   *
   * Antes validar solo marcaba "visto": en la prueba del 19-10 un adelanto de
   * S/ 25 a provincia quedó fuera de caja, la nota seguía debiendo el total y
   * el despacho mandaba cobrar S/ 50 en la agencia cuando faltaban S/ 25.
   *
   * El monto es el que confirma quien valida y, si no lo da, el que la IA leyó
   * de la foto. Sin ninguno de los dos no se inventa: se avisa.
   */
  private async registrarAdelanto(
    empresaId: number,
    pago: {
      id?: number;
      conversacionId: number;
      montoLeido: unknown;
      medioLeido: string | null;
      operacionLeida: string | null;
      recibidoEn?: Date | null;
    },
    montoConfirmado: number | undefined,
    usuarioId: number | undefined,
  ): Promise<{ registrado: boolean; monto?: number; motivo?: string }> {
    if (!this.pagos) return { registrado: false };
    const borrador = await this.prisma.leadPedidoBorrador.findUnique({
      where: { conversacionId: pago.conversacionId },
      select: { comprobanteId: true, registradoEn: true },
    });
    if (!borrador?.comprobanteId) {
      return {
        registrado: false,
        motivo: 'El pedido todavía no está registrado: el pago no se pudo asentar.',
      };
    }
    // El voucher llegó ANTES de registrar el pedido: la nota ya nació con
    // ese monto como adelanto (registrarPedido suma lo leído de los
    // vouchers). Asentarlo otra vez al validar lo cobraba dos veces: en la
    // prueba del 20-10 un Yape de S/ 12 dejó la NV01-00000028 en COMPLETADO
    // con saldo 0 y la agencia sin nada que cobrar, cuando faltaban S/ 12.
    // Solo se asienta lo que quien valida confirme por encima de lo leído.
    const yaContado =
      borrador.registradoEn &&
      pago.recibidoEn &&
      pago.recibidoEn <= borrador.registradoEn &&
      pago.montoLeido != null
        ? Number(pago.montoLeido)
        : 0;
    if (yaContado > 0) {
      const extra =
        Math.round(((montoConfirmado ?? yaContado) - yaContado) * 100) / 100;
      if (Math.abs(extra) < 0.01) {
        return { registrado: true, monto: yaContado };
      }
      if (extra < 0) {
        return {
          registrado: false,
          motivo: `Este pago ya entró en la nota al registrar el pedido, por S/ ${yaContado.toFixed(2)} (lo leído del comprobante). Corrige la diferencia a mano en la nota de venta.`,
        };
      }
      return this.registrarAdelanto(
        empresaId,
        { ...pago, montoLeido: extra, recibidoEn: null },
        extra,
        usuarioId,
      );
    }
    const nota = await this.prisma.comprobante.findFirst({
      where: { id: borrador.comprobanteId, empresaId },
      select: { saldo: true },
    });
    const pedido = Number(montoConfirmado ?? pago.montoLeido ?? 0);
    const despachoAntes = await this.prisma.envioDespacho.findUnique({
      where: { comprobanteId: borrador.comprobanteId },
      select: { montoCOD: true },
    });
    const pendiente =
      despachoAntes?.montoCOD != null
        ? Number(despachoAntes.montoCOD)
        : Number(nota?.saldo ?? 0);
    // Un monto leído que supera lo que falta no se asienta solo: pasó con un
    // Yape de S/ 500 (a otra cuenta) para un adelanto de S/ 50. Asentarlo
    // habría saldado la nota y dejado en 0 el cobro de la agencia.
    if (montoConfirmado == null && pendiente > 0 && pedido > pendiente + 0.01) {
      return {
        registrado: false,
        motivo: `El comprobante dice S/ ${pedido.toFixed(2)} y lo pendiente es S/ ${pendiente.toFixed(2)}: confirma el monto a mano.`,
      };
    }
    // El mismo número de operación ya pagó otro pedido: la misma captura
    // reenviada no es plata nueva. Solo pasa si quien valida confirma el
    // monto a mano, igual que un monto que no cuadra.
    const operacion = pago.operacionLeida?.trim();
    if (montoConfirmado == null && operacion) {
      const yaUsada = await this.prisma.leadComprobantePago
        .count({
          where: {
            empresaId,
            operacionLeida: operacion,
            validadoEn: { not: null },
            ...(pago.id ? { id: { not: pago.id } } : {}),
          },
        })
        .catch(() => 0);
      if (yaUsada > 0) {
        return {
          registrado: false,
          motivo: `La operación ${operacion} ya se usó en otro pago validado: puede ser la misma captura reenviada. Revísalo y, si es correcto, confirma el monto a mano.`,
        };
      }
    }
    if (!(pedido > 0)) {
      return {
        registrado: false,
        motivo: 'No se leyó el monto del comprobante: regístralo a mano en la nota de venta.',
      };
    }
    // El saldo de la nota es solo la mercadería; el envío se cobra aparte. Lo
    // que exceda el saldo no se asienta en la nota (registrarPago lo rechaza),
    // pero sí se descuenta de lo que el repartidor o la agencia debe cobrar.
    const monto = Math.min(pedido, Number(nota?.saldo ?? 0));
    if (monto > 0) {
      // ¿Es el primer pago de la nota? Entonces la nota toma su medio: el
      // panel de ventas muestra el de la nota, que nace "EFECTIVO" por
      // defecto, y un adelanto por Yape se veía como efectivo (20-10).
      const pagosPrevios = await this.prisma.pago
        .count({ where: { comprobanteId: borrador.comprobanteId } })
        .catch(() => 1);
      await this.pagos.registrarPago(
        borrador.comprobanteId,
        {
          monto,
          medioPago: medioDePago(pago.medioLeido),
          referencia: pago.operacionLeida ?? undefined,
          observacion: 'Adelanto validado desde el embudo de IA de Ventas',
        },
        usuarioId,
        empresaId,
      );
      if (pagosPrevios === 0) {
        await this.prisma.comprobante
          .update({
            where: { id: borrador.comprobanteId },
            data: { medioPago: medioDePago(pago.medioLeido) },
          })
          .catch(() => undefined);
      }
    }
    const despacho = await this.prisma.envioDespacho.findUnique({
      where: { comprobanteId: borrador.comprobanteId },
      select: { id: true, montoCOD: true },
    });
    if (despacho?.montoCOD != null) {
      await this.prisma.envioDespacho.update({
        where: { id: despacho.id },
        data: {
          montoCOD: Math.max(0, Number(despacho.montoCOD) - pedido),
        },
      });
    }
    return { registrado: true, monto: pedido };
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

/** El medio que la IA leyó del voucher, con los nombres que usa la caja. */
export function medioDePago(leido: string | null | undefined): string {
  const t = String(leido ?? '').toLowerCase();
  if (t.includes('yape')) return 'YAPE';
  if (t.includes('plin')) return 'PLIN';
  // El link de pago del chat: se registra igual que en la tienda.
  if (t.includes('mercado')) return 'MERCADO_PAGO';
  return 'TRANSFERENCIA';
}
