import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ComprobanteService } from '../comprobante/comprobante.service';
import { EnvioDespachoService } from '../envio-despacho/envio-despacho.service';
import { TiendaService } from './tienda.service';
import { MENSAJES_STOCK_TIENDA } from './stock-tienda';
import { verificarPuedeVenderEnSede } from '../usuarios/puede-vender-en-sede.util';
import {
  cobroDeNotaVenta,
  hoyLima,
  lineasDeNotaVenta,
  MEDIOS_PAGO_NV,
  transportistaDelPedido,
  type MedioPagoNv,
} from './pedido-nota-venta';

/**
 * Genera la nota de venta de un pedido de la tienda sin pasar por el punto de
 * venta: nota → pedido vinculado → despacho (si es envío). La guía de Shalom
 * la genera el panel después, con la misma regla opt-in que el POS.
 *
 * El despacho es best-effort, como en el pedido por WhatsApp: si falla, la
 * nota ya existe y se avisa para completarlo desde "Coordinar envío".
 */
@Injectable()
export class PedidoNotaVentaService {
  private readonly logger = new Logger(PedidoNotaVentaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comprobantes: ComprobanteService,
    private readonly despacho: EnvioDespachoService,
    private readonly tienda: TiendaService,
  ) {}

  /**
   * @param opts.sedeId sede de la que sale la nota cuando el pedido no tiene
   *   (modo TODAS). Si el pedido ya tiene sede, manda la del pedido.
   * @param usuario quien la genera: se verifica que venda en la sede de la
   *   nota, y su caja es la que exige "caja abierta para emitir".
   */
  async generar(
    empresaId: number,
    pedidoId: number,
    opts: { adelanto?: number; medioPago?: string; sedeId?: unknown },
    usuarioId?: number,
    usuario?: { rol?: string; sedeId?: number | null; sedesSinVenta?: number[] },
  ) {
    const pedido = await this.prisma.pedidoTienda.findFirst({
      where: { id: pedidoId, empresaId },
      include: { items: { include: { producto: { select: { descripcion: true } } } } },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    if (pedido.comprobanteId) {
      throw new BadRequestException('Este pedido ya tiene su comprobante.');
    }
    if (pedido.estado === 'CANCELADO') {
      throw new BadRequestException('El pedido está cancelado.');
    }
    if (!pedido.items.length) throw new BadRequestException('El pedido no tiene productos.');

    const sedeId = await this.sedeDeLaNota(
      empresaId,
      pedido.sedeId,
      opts.sedeId,
      usuario?.sedeId ?? null,
    );
    if (usuario) verificarPuedeVenderEnSede({ ...usuario, sedeId: sedeId ?? null }, 'NV');

    const medio = String(opts.medioPago ?? 'EFECTIVO').toUpperCase() as MedioPagoNv;
    if (!MEDIOS_PAGO_NV.includes(medio)) {
      throw new BadRequestException('Medio de pago inválido.');
    }
    const adelanto = Number(opts.adelanto ?? 0);
    if (!Number.isFinite(adelanto) || adelanto < 0) {
      throw new BadRequestException('El adelanto no puede ser negativo.');
    }

    const total = Number(pedido.total);
    const cobro = cobroDeNotaVenta(total, adelanto, medio);
    const clienteId = await this.clienteDelPedido(empresaId, pedido);
    const esEnvio = pedido.tipoEntrega === 'ENVIO';
    const doc = String(pedido.clienteDocumento ?? '').replace(/\D/g, '');

    const nv = (await this.comprobantes.crearInformal(
      {
        tipoDoc: 'NV',
        fechaEmision: new Date().toISOString(),
        formaPagoTipo: cobro.formaPagoTipo,
        formaPagoMoneda: 'PEN',
        tipoMoneda: 'PEN',
        ...(cobro.formaPagoTipo === 'CONTADO' ? { medioPago: cobro.medioPago } : {}),
        ...(cobro.formaPagoTipo === 'CREDITO' && cobro.adelanto > 0
          ? { adelanto: cobro.adelanto, medioPago: cobro.medioPago }
          : {}),
        ...(clienteId ? { clienteId } : { clienteName: 'CLIENTES VARIOS' }),
        observaciones: [
          `Pedido tienda: ${pedido.codigoSeguimiento}`,
          esEnvio
            ? pedido.envioCourier
              ? `Recoge en agencia ${pedido.envioCourier === 'OLVA' ? 'Olva' : 'Shalom'}: ${pedido.envioAgenciaNombre ?? ''}`
              : `Entrega: ${pedido.clienteDireccion || 'por coordinar'}`
            : 'Recojo en tienda',
          !clienteId ? `Cliente: ${pedido.clienteNombre}${doc ? ` · DNI ${doc}` : ''}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        detalles: lineasDeNotaVenta(pedido as any),
        // Sede del pedido y "vender sin stock" de la tienda (ComprobanteService
        // → reglasVentaDesdePedidoTienda).
        pedidoTiendaId: pedido.id,
      },
      empresaId,
      usuarioId,
      sedeId,
      { sedeCajaId: usuario?.sedeId ?? undefined },
    )) as { id: number; serie: string; correlativo: number; mtoImpVenta?: unknown; saldo?: unknown };
    if (!nv?.id) throw new BadRequestException('No se pudo generar la nota de venta.');

    // Vincular primero: el despacho sincroniza el estado del pedido enlazado.
    await this.tienda.vincularComprobante(empresaId, pedidoId, nv.id, usuarioId);

    let despacho: { id: number; transportista: string | null } | null = null;
    let avisoDespacho: string | null = null;
    if (esEnvio) {
      const transportista = transportistaDelPedido(pedido as any);
      const porAgencia = !!pedido.envioCourier;
      const destino = porAgencia
        ? pedido.envioAgenciaNombre || ''
        : pedido.clienteDireccion || '';
      try {
        const creado: any = await this.despacho.create(
          nv.id,
          empresaId,
          {
            transportista,
            tipoEnvio: (porAgencia ? 'AGENCIA' : 'DOMICILIO') as never,
            agenciaDestino: destino,
            ...(porAgencia ? {} : { direccionDestino: destino }),
            ...(pedido.envioCourier === 'SHALOM' && pedido.envioAgenciaId
              ? { shalomAgenciaDestinoId: String(pedido.envioAgenciaId) }
              : {}),
            celularDest: String(pedido.clienteTelefono ?? '').replace(/\D/g, '').slice(-9),
            nombreDestinatario: pedido.clienteNombre,
            ...(doc ? { dniDestinatario: doc } : {}),
            nroPaquetes: 1,
            turnoEnvio: 'MANANA',
            fechaEstimada: hoyLima(),
            costoEnvio: Number(pedido.costoEnvio) || 0,
            aplicacionMontoCliente: (Number(pedido.costoEnvio) > 0 ? 'ITEM_ENVIO' : 'NEGOCIO') as never,
            ...(pedido.clienteReferencia ? { observaciones: pedido.clienteReferencia } : {}),
            // Reparto propio: si queda algo por cobrar, se cobra al entregar.
            ...(transportista === 'PROPIOS'
              ? {
                  tipoVentaReparto: (cobro.porCobrar > 0 ? 'CONTRAENTREGA' : 'SOLO_ENTREGA') as never,
                  formaPagoCobro: (cobro.porCobrar > 0 ? 'EFECTIVO' : 'NO_COBRAR') as never,
                  ...(cobro.porCobrar > 0 ? { montoCOD: cobro.porCobrar } : {}),
                }
              : {}),
          } as any,
          usuarioId,
        );
        despacho = { id: creado.id, transportista: creado.transportista ?? transportista };
      } catch (e) {
        avisoDespacho = `La nota se generó, pero no se pudo crear el despacho: ${e instanceof Error ? e.message : String(e)}. Complétalo desde "Coordinar envío".`;
        this.logger.warn(`Pedido ${pedido.codigoSeguimiento}: ${avisoDespacho}`);
      }
    }

    const comprobante = await this.prisma.comprobante.findUnique({
      where: { id: nv.id },
      select: { id: true, serie: true, correlativo: true, mtoImpVenta: true, saldo: true, estadoPago: true, s3PdfUrl: true },
    });
    return { comprobante, despacho, avisoDespacho };
  }

  /**
   * De qué sede sale la nota:
   *   1. la del pedido (con el pedido en una sede, la nota que saliera de otra
   *      descontaría el stock equivocado);
   *   2. la elegida en el panel (`body.sedeId`, pedido sin sede = modo TODAS);
   *   3. la del usuario que la genera, como antes: la app 2.8.0 no manda
   *      `sedeId` y "Generar ya" no puede romperse para las empresas multi-sede;
   *   4. la única sede activa, o la principal.
   * Sin sedes (empresas antiguas) sigue como antes: `undefined`.
   */
  private async sedeDeLaNota(
    empresaId: number,
    sedePedido: number | null,
    sedeElegida: unknown,
    sedeUsuario: number | null,
  ): Promise<number | undefined> {
    if (sedePedido) return sedePedido;
    if (sedeElegida != null && sedeElegida !== '') {
      const id = Number(sedeElegida);
      const sede =
        Number.isInteger(id) && id > 0
          ? await this.prisma.sede.findFirst({
              where: { id, empresaId, activo: true },
              select: { id: true },
            })
          : null;
      if (!sede) throw new BadRequestException(MENSAJES_STOCK_TIENDA.sedeInvalida);
      return sede.id;
    }
    const activas = await this.prisma.sede.findMany({
      where: { empresaId, activo: true },
      select: { id: true, esPrincipal: true },
    });
    if (sedeUsuario && activas.some((s) => s.id === sedeUsuario)) return sedeUsuario;
    if (activas.length === 1) return activas[0].id;
    return activas.find((s) => s.esPrincipal)?.id;
  }

  /**
   * Cliente de la nota: el que ya tiene ese DNI/RUC; si no existe y dejó
   * documento, se registra (la nota sale a su nombre y la próxima compra lo
   * encuentra). Sin documento va a CLIENTES VARIOS con el nombre en la nota.
   */
  private async clienteDelPedido(
    empresaId: number,
    pedido: { clienteNombre: string; clienteDocumento: string | null; clienteTelefono: string; clienteDireccion: string | null; envioCourier: string | null },
  ): Promise<number | null> {
    const doc = String(pedido.clienteDocumento ?? '').replace(/\D/g, '');
    if (![8, 11].includes(doc.length)) return null;
    const existente = await this.prisma.cliente.findFirst({
      where: { empresaId, nroDoc: doc },
      select: { id: true },
    });
    if (existente) return existente.id;
    const tipo = await this.prisma.tipoDocumento
      .findFirst({ where: { codigo: doc.length === 11 ? '6' : '1' }, select: { id: true } })
      .catch(() => null);
    const celular = String(pedido.clienteTelefono ?? '').replace(/\D/g, '').slice(-9);
    const creado = await this.prisma.cliente.create({
      data: {
        empresaId,
        nombre: pedido.clienteNombre.trim().toUpperCase(),
        nroDoc: doc,
        ...(tipo ? { tipoDocumentoId: tipo.id } : {}),
        ...(celular.length === 9 ? { telefono: celular } : {}),
        // La dirección de un pedido por agencia es la agencia, no su casa.
        ...(pedido.clienteDireccion && !pedido.envioCourier ? { direccion: pedido.clienteDireccion } : {}),
      },
      select: { id: true },
    });
    return creado.id;
  }
}
