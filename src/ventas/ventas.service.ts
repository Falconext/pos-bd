import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoSunat } from '@prisma/client';

const TIPOS_SUNAT = ['01', '03', '07', '08'];
const TIPOS_INFORMALES = ['TICKET', 'NV', 'NP', 'RH', 'CP', 'OT'];

const TIPO_LABEL: Record<string, string> = {
    '01': 'FACTURA',
    '03': 'BOLETA',
    '07': 'NOTA_CREDITO',
    '08': 'NOTA_DEBITO',
    TICKET: 'TICKET',
    NV: 'NOTA_VENTA',
    NP: 'NOTA_PEDIDO',
    RH: 'RECIBO_HONORARIOS',
    CP: 'COMP_PAGO',
    OT: 'OTRO',
};

const DESPACHO_ESTADO_MAP: Record<string, string> = {
    POR_COORDINAR: 'PREPARANDO',
    SIN_ASIGNAR: 'PREPARANDO',
    NO_APLICA: 'PREPARANDO',
    ENVIADO: 'EN_CAMINO',
    EN_REPARTO: 'EN_CAMINO',
    ENTREGADO_COMPLETADO: 'ENTREGADO',
    INCIDENCIA: 'DEVUELTO',
};

function normalizarDespachoEstado(estado: string): string {
    return DESPACHO_ESTADO_MAP[estado] ?? estado;
}

function normalizarSunat(estadoEnvioSunat: EstadoSunat | string | null, sunatCdrResponse: any): string {
    const raw = String(estadoEnvioSunat ?? '').toUpperCase();
    if (raw === 'ANULADO' || raw === 'NO_APLICA') return raw;

    let cdr: any = null;
    if (typeof sunatCdrResponse === 'string') {
        try { cdr = JSON.parse(sunatCdrResponse); } catch { cdr = null; }
    } else {
        cdr = sunatCdrResponse;
    }

    const code = String(cdr?.code ?? '');
    const label = String(cdr?.state_label ?? cdr?.estado ?? raw).toUpperCase();

    if (code === '0' || label === 'ACEPTADO' || label === 'OBSERVADO' || raw === 'EMITIDO') return 'ACEPTADO';
    if (raw === 'RECHAZADO') return 'RECHAZADO';
    return 'PENDIENTE';
}

function resolverMetodoPago(pagos: { medioPago: string; monto: number }[], medioPago?: string | null): string {
    if (pagos.length === 0) return medioPago ?? '—';
    if (pagos.length === 1) return pagos[0].medioPago || '—';
    const unicos = new Set(pagos.map((p) => p.medioPago));
    return unicos.size === 1 ? [...unicos][0] : 'Mixto';
}

const ESTADOS_PAGADO = new Set(['PAGADO', 'PAGADO_PAGO', 'COMPLETADO']);
const ESTADOS_PARCIAL = new Set(['PAGO_PARCIAL', 'PARCIAL']);
const TIPOS_NO_VENTA_FINAL = new Set(['07', 'NP', 'OT']);

function calcularSaldoRealComprobante(comprobante: {
    mtoImpVenta: any;
    estadoPago: string | null;
    saldo: any;
    adelanto?: any;
    pagos?: { monto: number }[];
}) {
    const mtoImpVentaNum = Number(comprobante.mtoImpVenta ?? 0);
    const epRaw = comprobante.estadoPago ?? '';
    const saldoDB = Number(comprobante.saldo ?? 0);
    const adelantoNum = Number(comprobante.adelanto ?? 0);
    const totalPagadoPagos = (comprobante.pagos ?? []).reduce((s, p) => s + Number(p.monto ?? 0), 0);

    if (saldoDB > 0) return saldoDB;
    if (ESTADOS_PAGADO.has(epRaw)) return 0;
    if (ESTADOS_PARCIAL.has(epRaw) || epRaw === 'PAGO_PARCIAL') {
        return Math.max(0, mtoImpVentaNum - totalPagadoPagos - adelantoNum);
    }
    if (epRaw === 'PENDIENTE_PAGO') {
        return Math.max(0, mtoImpVentaNum - totalPagadoPagos);
    }
    return 0;
}

function resolverEstadoPagoComprobante(
    mtoImpVenta: number,
    estadoPago: string | null,
    pagos: { monto: number }[],
    esSunat = false,
): string {
    const ep = estadoPago ?? '';
    if (ESTADOS_PAGADO.has(ep)) return 'PAGADO';
    if (ESTADOS_PARCIAL.has(ep)) return 'PARCIAL';
    // Para Boleta/Factura emitida sin registro explícito de pago: si no hay
    // cuotas pendientes confirmadas, asumimos pago al contado en el acto.
    if (esSunat && ep === 'PENDIENTE_PAGO') {
        const totalPagado = pagos.reduce((s, p) => s + (p.monto ?? 0), 0);
        if (totalPagado >= mtoImpVenta - 0.01) return 'PAGADO';
        if (totalPagado > 0) return 'PARCIAL';
        // Sin registro de pago pero es documento formal → PENDIENTE (puede ser crédito)
        return 'PENDIENTE';
    }
    const totalPagado = pagos.reduce((s, p) => s + (p.monto ?? 0), 0);
    if (totalPagado >= mtoImpVenta - 0.01) return 'PAGADO';
    if (totalPagado > 0) return 'PARCIAL';
    return 'PENDIENTE';
}

@Injectable()
export class VentasService {
    constructor(private readonly prisma: PrismaService) {}

    private async resumenPorCobrarGlobal(params: { empresaId: number; sedeId?: number; usuarioId?: number }) {
        const { empresaId, sedeId, usuarioId } = params;
        const sedeFilter = sedeId ? { sedeId } : {};
        const comprobanteUsuarioFilter = usuarioId ? { usuarioId } : {};
        const pedidoUsuarioFilter = usuarioId ? { vendedorId: usuarioId } : {};

        const [comprobantes, pedidos] = await Promise.all([
            this.prisma.comprobante.findMany({
                where: {
                    empresaId,
                    ...sedeFilter,
                    ...comprobanteUsuarioFilter,
                    tipoDoc: { in: [...TIPOS_SUNAT, ...TIPOS_INFORMALES] },
                    estadoEnvioSunat: { not: 'ANULADO' },
                    estadoPago: { not: 'ANULADO' as any },
                    OR: [
                        { saldo: { gt: 0 } },
                        { estadoPago: { in: ['PENDIENTE_PAGO', 'PAGO_PARCIAL'] as any } },
                    ],
                },
                select: {
                    id: true,
                    tipoDoc: true,
                    mtoImpVenta: true,
                    estadoPago: true,
                    saldo: true,
                    adelanto: true,
                    pagos: { select: { monto: true } },
                    comprobantesDerivados: { select: { id: true } },
                },
            }),
            this.prisma.pedidoTienda.findMany({
                where: {
                    empresaId,
                    ...sedeFilter,
                    ...pedidoUsuarioFilter,
                    estado: { not: 'CANCELADO' },
                    saldoPendiente: { gt: 0 },
                },
                select: {
                    id: true,
                    saldoPendiente: true,
                },
            }),
        ]);

        const comprobantesPendientes = comprobantes
            .filter((c) => !TIPOS_NO_VENTA_FINAL.has(c.tipoDoc))
            .filter((c) => (c.comprobantesDerivados ?? []).length === 0)
            .map((c) => calcularSaldoRealComprobante(c))
            .filter((saldo) => saldo > 0.01);

        const saldosPedidos = pedidos
            .map((p) => Number(p.saldoPendiente ?? 0))
            .filter((saldo) => saldo > 0.01);

        const pendientes = [...comprobantesPendientes, ...saldosPedidos];
        return {
            cantidad: pendientes.length,
            total: Number(pendientes.reduce((sum, saldo) => sum + saldo, 0).toFixed(2)),
        };
    }

    async panelVentas(params: { empresaId: number; fecha: string; sedeId?: number; usuarioId?: number }) {
        const { empresaId, fecha, sedeId, usuarioId } = params;

        const inicioLima = new Date(`${fecha}T00:00:00-05:00`);
        const finLima = new Date(`${fecha}T23:59:59-05:00`);

        const sedeFilter = sedeId ? { sedeId } : {};
        const comprobanteUsuarioFilter = usuarioId ? { usuarioId } : {};
        const pedidoUsuarioFilter = usuarioId ? { vendedorId: usuarioId } : {};

        const [comprobantesRaw, pedidosRaw, porCobrarGlobal] = await Promise.all([
            this.prisma.comprobante.findMany({
                where: {
                    empresaId,
                    ...sedeFilter,
                    ...comprobanteUsuarioFilter,
                    fechaEmision: { gte: inicioLima, lte: finLima },
                    tipoDoc: { in: [...TIPOS_SUNAT, ...TIPOS_INFORMALES] },
                    estadoEnvioSunat: { not: 'ANULADO' },
                },
                orderBy: { fechaEmision: 'desc' },
                select: {
                    id: true,
                    tipoDoc: true,
                    serie: true,
                    correlativo: true,
                    fechaEmision: true,
                    mtoImpVenta: true,
                    estadoEnvioSunat: true,
                    sunatCdrResponse: true,
                    estadoPago: true,
                    medioPago: true,
                    saldo: true,
                    adelanto: true,
                    formaPagoTipo: true,
                    montoDetraccion: true,
                    porcentajeDetraccion: true,
                    cuotas: true,
                    observaciones: true,
                    cliente: { select: { nombre: true, nroDoc: true } },
                    usuario: { select: { nombre: true } },
                    sede: { select: { nombre: true } },
                    productoSeries: { select: { numeroSerie: true } },
                    envioDespacho: {
                        select: {
                            estado: true,
                            tipoEnvio: true,
                            agenciaDestino: true,
                            celularDest: true,
                            nroPaquetes: true,
                            turnoEnvio: true,
                            transportista: true,
                            nroOrden: true,
                            claveOrden: true,
                            repartidorId: true,
                            repartidor: { select: { nombre: true } },
                        },
                    },
                    pagos: { select: { medioPago: true, monto: true } },
                    // Para detectar si este comprobante informal ya fue convertido
                    comprobantesDerivados: { select: { id: true, tipoDoc: true, serie: true, correlativo: true } },
                    // Para saber si este comprobante formal viene de un informal
                    comprobanteOrigenId: true,
                    comprobanteOrigen: { select: { serie: true, correlativo: true, tipoDoc: true } },
                    detalles: {
                        select: {
                            descripcion: true,
                            cantidad: true,
                            mtoPrecioUnitario: true,
                            unidad: true,
                        },
                    },
                },
            }),

            this.prisma.pedidoTienda.findMany({
                where: {
                    empresaId,
                    ...sedeFilter,
                    ...pedidoUsuarioFilter,
                    creadoEn: { gte: inicioLima, lte: finLima },
                },
                orderBy: { creadoEn: 'desc' },
                select: {
                    id: true,
                    codigoSeguimiento: true,
                    clienteNombre: true,
                    total: true,
                    montoPagado: true,
                    saldoPendiente: true,
                    estadoEnvio: true,
                    medioPago: true,
                    creadoEn: true,
                    vendedorNombre: true,
                    clienteDireccion: true,
                    clienteTelefono: true,
                    repartidorId: true,
                    repartidor: { select: { nombre: true } },
                    sede: { select: { nombre: true } },
                    items: {
                        select: {
                            cantidad: true,
                            precioUnit: true,
                            producto: { select: { descripcion: true } },
                        },
                    },
                },
            }),
            this.resumenPorCobrarGlobal({ empresaId, sedeId, usuarioId }),
        ]);

        const comprobantesNorm = comprobantesRaw.map((c) => {
            const esSunat = TIPOS_SUNAT.includes(c.tipoDoc);
            const pagos = (c.pagos ?? []) as { medioPago: string; monto: number }[];
            const derivado = (c.comprobantesDerivados ?? [])[0] ?? null;
            const epRaw = (c.estadoPago as string) ?? '';
            // Compute saldo real: if DB saldo is correctly set, use it;
            // otherwise derive from estadoPago + pagos + adelanto (handles old NPs
            // created before saldo was properly initialized on the comprobante)
            const saldoReal = calcularSaldoRealComprobante({ ...c, estadoPago: epRaw, pagos });

            // Comprobante informal que ya fue convertido a boleta/factura
            const esConvertida = derivado != null;
            const convertidaEn = derivado
                ? `${derivado.serie}-${String(derivado.correlativo).padStart(8, '0')}`
                : null;

            // Comprobante formal que vino de un informal
            const origenReferencia = c.comprobanteOrigen
                ? `${c.comprobanteOrigen.serie}-${String(c.comprobanteOrigen.correlativo).padStart(8, '0')}`
                : null;

            return {
                id: c.id,
                tipo: TIPO_LABEL[c.tipoDoc] ?? c.tipoDoc,
                referencia: `${c.serie}-${String(c.correlativo).padStart(8, '0')}`,
                fecha: c.fechaEmision.toISOString(),
                clienteDoc: c.cliente?.nroDoc ?? '',
                cliente: c.cliente?.nombre ?? '—',
                seriesGarantia: (c.productoSeries ?? []).map((s) => s.numeroSerie),
                total: Number(c.mtoImpVenta ?? 0),
                estadoPago: resolverEstadoPagoComprobante(
                    Number(c.mtoImpVenta ?? 0),
                    c.estadoPago as string | null,
                    pagos,
                    esSunat,
                ),
                metodoPago: resolverMetodoPago(pagos, c.medioPago),
                estadoSunat: esSunat
                    ? normalizarSunat(c.estadoEnvioSunat, c.sunatCdrResponse)
                    : 'NO_APLICA',
                estadoDespacho: c.envioDespacho
                    ? normalizarDespachoEstado(c.envioDespacho.estado)
                    : 'NO_APLICA',
                repartidorId: c.envioDespacho?.repartidorId ?? null,
                repartidor: c.envioDespacho?.repartidor?.nombre ?? 'No aplica',
                tipoEnvio: c.envioDespacho?.tipoEnvio ?? '—',
                agenciaDestino: c.envioDespacho?.agenciaDestino ?? '—',
                celularDest: c.envioDespacho?.celularDest ?? '—',
                nroPaquetes: c.envioDespacho?.nroPaquetes ?? null,
                turnoEnvio: c.envioDespacho?.turnoEnvio ?? '—',
                courier: c.envioDespacho?.transportista ?? '',
                nroOrden: c.envioDespacho?.nroOrden ?? '',
                claveOrden: c.envioDespacho?.claveOrden ?? '',
                vendedor: c.usuario?.nombre ?? '—',
                sede: c.sede?.nombre ?? '—',
                comprobanteId: c.id,
                pedidoId: null,
                esConvertida,
                convertidaEn,
                origenReferencia,
                // Para cobros inline (ModalRegistrarPago, ModalHistorialPagos, ModalDetalleCuenta)
                saldo: saldoReal,
                estadoPagoRaw: epRaw || 'PENDIENTE_PAGO',
                formaPagoTipo: c.formaPagoTipo ?? 'CONTADO',
                montoDetraccion: Number(c.montoDetraccion ?? 0),
                porcentajeDetraccion: Number(c.porcentajeDetraccion ?? 0),
                cuotas: c.cuotas ?? null,
                observaciones: c.observaciones ?? null,
                productos: (c.detalles ?? []).map((d) => ({
                    nombre: d.descripcion,
                    cantidad: Number(d.cantidad),
                    precioUnitario: Number(d.mtoPrecioUnitario),
                    unidad: d.unidad,
                })),
            };
        });

        const pedidosNorm = pedidosRaw.map((p) => {
            const montoPagado = Number(p.montoPagado ?? 0);
            const saldoPendiente = Number(p.saldoPendiente ?? 0);
            const total = Number(p.total ?? 0);

            let estadoPago: string;
            if (saldoPendiente <= 0.01) estadoPago = 'PAGADO';
            else if (montoPagado > 0) estadoPago = 'PARCIAL';
            else estadoPago = 'PENDIENTE';

            return {
                id: p.id,
                tipo: 'PEDIDO_TIENDA',
                referencia: p.codigoSeguimiento,
                fecha: p.creadoEn.toISOString(),
                clienteDoc: '',
                seriesGarantia: [],
                cliente: p.clienteNombre ?? '—',
                total,
                estadoPago,
                metodoPago: p.medioPago ?? '—',
                estadoSunat: 'NO_APLICA',
                estadoDespacho: normalizarDespachoEstado(p.estadoEnvio ?? 'SIN_ASIGNAR'),
                repartidorId: p.repartidorId ?? null,
                repartidor: p.repartidor?.nombre ?? 'No aplica',
                tipoEnvio: 'AGENCIA',
                agenciaDestino: p.clienteDireccion ?? '—',
                celularDest: p.clienteTelefono ?? '—',
                nroPaquetes: 1,
                turnoEnvio: '—',
                vendedor: p.vendedorNombre ?? 'Tienda online',
                sede: p.sede?.nombre ?? '—',
                comprobanteId: null,
                pedidoId: p.id,
                esConvertida: false,
                convertidaEn: null,
                origenReferencia: null,
                saldo: saldoPendiente,
                estadoPagoRaw: saldoPendiente <= 0.01 ? 'COMPLETADO' : montoPagado > 0 ? 'PAGO_PARCIAL' : 'PENDIENTE_PAGO',
                formaPagoTipo: 'CONTADO',
                montoDetraccion: 0,
                porcentajeDetraccion: 0,
                cuotas: null,
                observaciones: null,
                productos: (p.items ?? []).map((i) => ({
                    nombre: i.producto?.descripcion ?? '—',
                    cantidad: Number(i.cantidad),
                    precioUnitario: Number(i.precioUnit),
                    unidad: 'NIU',
                })),
            };
        });

        const data = [...comprobantesNorm, ...pedidosNorm].sort(
            (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
        );

        return {
            data,
            total: data.length,
            resumen: {
                porCobrarGlobal,
            },
        };
    }
}
