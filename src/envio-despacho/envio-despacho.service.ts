import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEnvioDespachoDto, UpdateEnvioDespachoDto, EstadoDespacho } from './dto/envio-despacho.dto';
import { DespachoConfigDto } from './dto/despacho-config.dto';
import { RepartidorService } from '../repartidor/repartidor.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

const ESTADOS_NOTIFICABLES = new Set([EstadoDespacho.EN_CAMINO, EstadoDespacho.EN_AGENCIA, EstadoDespacho.ENTREGADO]);

const MENSAJES_DEFAULT: Record<string, string> = {
    EN_CAMINO:  'Hola {{nombre}}, tu pedido {{pedido}} ya está en camino 🚚. Repartidor: {{repartidor}}.',
    ENTREGADO:  'Hola {{nombre}}, tu pedido {{pedido}} fue entregado exitosamente ✅. ¡Gracias por preferir {{empresa}}!',
};

const DESPACHO_FIELDS = [
    'transportista', 'codigoGuia', 'observaciones', 'direccionDestino',
    'tipoEnvio', 'agenciaDestino', 'celularDest', 'nroPaquetes',
    'turnoEnvio', 'tipoMercaderia', 'claveEnvio', 'nroOrden', 'claveOrden',
    'establecimiento', 'empaquetador',
    'nombreDestinatario', 'dniDestinatario', 'contenidoPaquete', 'montoCOD',
] as const;

const DESPACHO_TO_PEDIDO_ESTADO: Record<EstadoDespacho, { estadoEntrega: string; estadoEnvio: string }> = {
    [EstadoDespacho.PREPARANDO]: { estadoEntrega: 'CONFIRMADO', estadoEnvio: 'POR_COORDINAR' },
    [EstadoDespacho.EN_CAMINO]: { estadoEntrega: 'EN_TRANSITO', estadoEnvio: 'EN_REPARTO' },
    [EstadoDespacho.EN_AGENCIA]: { estadoEntrega: 'EN_AGENCIA', estadoEnvio: 'ENVIADO' },
    [EstadoDespacho.EN_DESTINO]: { estadoEntrega: 'EN_TRANSITO', estadoEnvio: 'EN_REPARTO' },
    [EstadoDespacho.ENTREGADO]: { estadoEntrega: 'ENTREGADO_COMPLETADO', estadoEnvio: 'ENTREGADO' },
    [EstadoDespacho.DEVUELTO]: { estadoEntrega: 'PENDIENTE', estadoEnvio: 'INCIDENCIA' },
};

@Injectable()
export class EnvioDespachoService {
    private readonly logger = new Logger(EnvioDespachoService.name);

    constructor(
        private prisma: PrismaService,
        private repartidorService: RepartidorService,
        private whatsapp: WhatsAppService,
    ) {}

    async getByComprobante(comprobanteId: number, empresaId: number) {
        await this.validateComprobante(comprobanteId, empresaId);
        const envio = await this.prisma.envioDespacho.findUnique({
            where: { comprobanteId },
            include: { repartidor: true },
        });
        return this.withLegacyRepartidor(envio);
    }

    async create(comprobanteId: number, empresaId: number, dto: CreateEnvioDespachoDto, usuarioId?: number) {
        const comprobante = await this.validateComprobante(comprobanteId, empresaId);
        const existing = await this.prisma.envioDespacho.findUnique({ where: { comprobanteId } });
        if (existing) throw new BadRequestException('Este comprobante ya tiene un seguimiento de despacho.');

        const estadoInicial: EstadoDespacho = dto.estado ?? EstadoDespacho.PREPARANDO;
        const usuarioNombre = await this.resolveUsuarioNombre(usuarioId);
        const historial = [{
            estado: estadoInicial,
            fecha: new Date().toISOString(),
            nota: 'Despacho creado',
            ...(usuarioId && { usuarioId, usuarioNombre }),
        }];
        const repartidorId = await this.repartidorService.resolveForEmpresa(empresaId, {
            repartidorId: dto.repartidorId,
            repartidor: dto.repartidor,
            sedeId: comprobante.sedeId,
        });

        const envio = await this.prisma.envioDespacho.create({
            data: {
                comprobanteId,
                estado: estadoInicial,
                historial,
                direccionDestino: dto.direccionDestino ?? comprobante.cliente?.direccion ?? null,
                fechaEstimada: dto.fechaEstimada ? new Date(dto.fechaEstimada) : null,
                ...(repartidorId !== undefined && { repartidorId }),
                ...this.pickFields(dto),
            },
            include: { repartidor: true },
        });
        await this.syncPedidoTiendaByComprobante(comprobanteId, estadoInicial);
        return this.withLegacyRepartidor(envio);
    }

    async upsert(comprobanteId: number, empresaId: number, dto: CreateEnvioDespachoDto, usuarioId?: number) {
        const existing = await this.prisma.envioDespacho.findUnique({ where: { comprobanteId } });
        if (existing) return this.update(comprobanteId, empresaId, dto, usuarioId);
        return this.create(comprobanteId, empresaId, dto, usuarioId);
    }

    async update(comprobanteId: number, empresaId: number, dto: UpdateEnvioDespachoDto, usuarioId?: number) {
        await this.validateComprobante(comprobanteId, empresaId);
        const envio = await this.prisma.envioDespacho.findUnique({ where: { comprobanteId } });
        if (!envio) throw new NotFoundException('No existe seguimiento de despacho para este comprobante.');

        let historial: any[] = Array.isArray(envio.historial) ? (envio.historial as any[]) : [];
        if (dto.estado && dto.estado !== envio.estado) {
            const usuarioNombre = await this.resolveUsuarioNombre(usuarioId);
            historial = [...historial, {
                estado: dto.estado,
                fecha: new Date().toISOString(),
                nota: dto.observaciones ?? null,
                ...(usuarioId && { usuarioId, usuarioNombre }),
            }];
        }
        const repartidorId = await this.repartidorService.resolveForEmpresa(empresaId, {
            repartidorId: dto.repartidorId,
            repartidor: dto.repartidor,
        });

        const estadoCambia = dto.estado && dto.estado !== envio.estado;

        const updated = await this.prisma.envioDespacho.update({
            where: { comprobanteId },
            data: {
                ...(dto.estado !== undefined && { estado: dto.estado as any }),
                ...(dto.fechaEstimada !== undefined && { fechaEstimada: new Date(dto.fechaEstimada) }),
                ...(repartidorId !== undefined && { repartidorId }),
                historial,
                ...this.pickFields(dto),
            },
            include: { repartidor: true },
        });

        if (estadoCambia && ESTADOS_NOTIFICABLES.has(dto.estado as EstadoDespacho)) {
            this.notificarCambioEstado(comprobanteId, empresaId, dto.estado as EstadoDespacho, updated.repartidor?.nombre ?? null)
                .catch((e) => this.logger.warn(`WA despacho fallido: ${e.message}`));
        }

        if (estadoCambia) {
            await this.syncPedidoTiendaByComprobante(comprobanteId, dto.estado as EstadoDespacho);
        }

        return this.withLegacyRepartidor(updated);
    }

    async getConfig(empresaId: number) {
        const config = await this.prisma.despachoMensajeTemplate.findUnique({ where: { empresaId } });
        return config ?? {
            empresaId,
            mensajeEnCamino: MENSAJES_DEFAULT.EN_CAMINO,
            mensajeEntregado: MENSAJES_DEFAULT.ENTREGADO,
            notificarEnCamino: true,
            notificarEntregado: true,
        };
    }

    async upsertConfig(empresaId: number, dto: DespachoConfigDto) {
        return this.prisma.despachoMensajeTemplate.upsert({
            where: { empresaId },
            create: { empresaId, ...dto },
            update: dto,
        });
    }

    async remove(comprobanteId: number, empresaId: number) {
        await this.validateComprobante(comprobanteId, empresaId);
        await this.prisma.envioDespacho.delete({ where: { comprobanteId } });
    }

    async listByEmpresa(empresaId: number, params?: { estado?: string; page?: number; limit?: number }) {
        const page = params?.page ?? 1;
        const limit = params?.limit ?? 50;
        const skip = (page - 1) * limit;

        const where: any = {
            comprobante: { empresaId },
            ...(params?.estado ? { estado: params.estado } : {}),
        };

        const [items, total] = await Promise.all([
            this.prisma.envioDespacho.findMany({
                where, skip, take: limit,
                orderBy: { creadoEn: 'desc' },
                include: {
                    comprobante: {
                        select: {
                            id: true, serie: true, correlativo: true, tipoDoc: true,
                            fechaEmision: true, mtoImpVenta: true,
                            cliente: { select: { id: true, nombre: true, nroDoc: true, telefono: true } },
                            usuario: { select: { nombre: true } },
                        },
                    },
                    repartidor: true,
                },
            }),
            this.prisma.envioDespacho.count({ where }),
        ]);

        return { data: items, total, page, totalPages: Math.ceil(total / limit) };
    }

    async panelUnificado(empresaId: number, params?: { fecha?: string; page?: number; limit?: number }) {
        const page = params?.page ?? 1;
        const limit = params?.limit ?? 50;
        const skip = (page - 1) * limit;

        const fechaWhere = params?.fecha
            ? {
                gte: new Date(`${params.fecha}T00:00:00-05:00`),
                lte: new Date(`${params.fecha}T23:59:59-05:00`),
            }
            : undefined;

        const [despachos, pedidos] = await Promise.all([
            this.prisma.envioDespacho.findMany({
                where: {
                    comprobante: { empresaId },
                    ...(fechaWhere ? { creadoEn: fechaWhere } : {}),
                },
                orderBy: { creadoEn: 'desc' },
                take: limit,
                skip,
                include: {
                    comprobante: {
                        select: {
                            id: true, serie: true, correlativo: true, tipoDoc: true,
                            fechaEmision: true, mtoImpVenta: true,
                            adelanto: true, saldo: true, estadoPago: true,
                            cliente: { select: { nombre: true, telefono: true, nroDoc: true } },
                            usuario: { select: { nombre: true } },
                        },
                    },
                    repartidor: true,
                },
            }),
            this.prisma.pedidoTienda.findMany({
                where: {
                    empresaId,
                    tipoEntrega: 'ENVIO',
                    ...(fechaWhere ? { creadoEn: fechaWhere } : {}),
                },
                orderBy: { creadoEn: 'desc' },
                take: limit,
                select: {
                    id: true, codigoSeguimiento: true, clienteNombre: true,
                    clienteTelefono: true, clienteDireccion: true,
                    total: true, montoPagado: true, saldoPendiente: true, agenciaEnvio: true, estadoEnvio: true,
                    estadoEntrega: true, creadoEn: true, repartidorId: true,
                    repartidor: true,
                    items: {
                        select: {
                            productoId: true,
                            cantidad: true,
                            precioUnit: true,
                            producto: { select: { id: true, codigo: true, descripcion: true } },
                        },
                    },
                },
            }),
        ]);

        const despachosNormalizados = despachos.map((d) => {
            const total = Number(d.comprobante.mtoImpVenta);
            const saldo = Number(d.comprobante.saldo ?? 0);
            const adelanto = Number(d.comprobante.adelanto ?? 0);
            const montoPagado = adelanto > 0 ? adelanto : (saldo === 0 ? total : total - saldo);
            return {
                tipo: 'COMPROBANTE' as const,
                id: d.id,
                comprobanteId: d.comprobanteId,
                comprobanteTipoDoc: d.comprobante.tipoDoc,
                referencia: `${d.comprobante.serie}-${String(d.comprobante.correlativo).padStart(8, '0')}`,
                cliente: d.comprobante.cliente?.nombre ?? '—',
                telefono: d.comprobante.cliente?.telefono ?? '',
                vendedor: d.comprobante.usuario?.nombre ?? '—',
                total,
                montoPagado,
                saldoPendiente: saldo,
                courier: d.transportista ?? '—',
                tipoEnvio: d.tipoEnvio ?? '—',
                agenciaDestino: d.agenciaDestino ?? '—',
                celularDest: d.celularDest ?? '',
                nroPaquetes: d.nroPaquetes ?? 1,
                turnoEnvio: d.turnoEnvio ?? '—',
                codigoGuia: d.codigoGuia ?? '',
                nroOrden: d.nroOrden ?? '',
                claveOrden: d.claveOrden ?? '',
                repartidorId: d.repartidorId,
                repartidor: d.repartidor?.nombre ?? '—',
                repartidorData: d.repartidor,
                estado: d.estado,
                creadoEn: d.creadoEn,
            };
        });

        const pedidosNormalizados = pedidos.map((p) => ({
            tipo: 'PEDIDO_TIENDA' as const,
            id: p.id,
            pedidoId: p.id,
            referencia: p.codigoSeguimiento,
            cliente: p.clienteNombre,
            telefono: p.clienteTelefono,
            vendedor: 'Tienda online',
            total: Number(p.total),
            montoPagado: Number(p.montoPagado ?? 0),
            saldoPendiente: Number(p.saldoPendiente ?? Math.max(Number(p.total) - Number(p.montoPagado ?? 0), 0)),
            courier: p.agenciaEnvio ?? '—',
            tipoEnvio: 'AGENCIA',
            agenciaDestino: p.clienteDireccion ?? '—',
            celularDest: p.clienteTelefono,
            nroPaquetes: 1,
            turnoEnvio: '—',
            codigoGuia: '',
            repartidorId: p.repartidorId,
            repartidor: p.repartidor?.nombre ?? '—',
            repartidorData: p.repartidor,
            estado: p.estadoEnvio,
            estadoEntrega: p.estadoEntrega,
            items: p.items,
            creadoEn: p.creadoEn,
        }));

        const todos = [...despachosNormalizados, ...pedidosNormalizados]
            .sort((a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime());

        return { data: todos, total: todos.length };
    }

    private async notificarCambioEstado(
        comprobanteId: number,
        empresaId: number,
        estado: EstadoDespacho,
        repartidorNombre: string | null,
    ): Promise<void> {
        const [comprobante, empresa, config] = await Promise.all([
            this.prisma.comprobante.findFirst({
                where: { id: comprobanteId },
                select: {
                    serie: true, correlativo: true,
                    cliente: { select: { nombre: true, telefono: true } },
                },
            }),
            this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { razonSocial: true } }),
            this.prisma.despachoMensajeTemplate.findUnique({ where: { empresaId } }),
        ]);

        const telefono = comprobante?.cliente?.telefono;
        if (!telefono) return;

        const esEnCamino = estado === EstadoDespacho.EN_CAMINO;
        const esEnAgencia = estado === EstadoDespacho.EN_AGENCIA;
        const pedidoRef = `${comprobante.serie}-${String(comprobante.correlativo).padStart(8, '0')}`;

        if (esEnAgencia) {
            const saldo = Number((comprobante as any)?.saldo ?? 0);
            const agencia = (await this.prisma.envioDespacho.findFirst({
                where: { comprobanteId },
                select: { agenciaDestino: true },
            }))?.agenciaDestino ?? 'la agencia';
            const msg = `Hola ${comprobante?.cliente?.nombre ?? 'Cliente'}! 📦 Tu pedido ${pedidoRef} llegó a ${agencia}. Para retirarlo confirma el pago restante de S/ ${saldo.toFixed(2)}. Te avisamos cuando esté listo. — ${empresa?.razonSocial ?? ''}`;
            await this.whatsapp.enviarTexto(telefono, msg);
            return;
        }

        const habilitado = esEnCamino
            ? (config?.notificarEnCamino ?? true)
            : (config?.notificarEntregado ?? true);
        if (!habilitado) return;

        const plantilla = esEnCamino
            ? (config?.mensajeEnCamino ?? MENSAJES_DEFAULT.EN_CAMINO)
            : (config?.mensajeEntregado ?? MENSAJES_DEFAULT.ENTREGADO);

        const mensaje = plantilla
            .replace(/\{\{nombre\}\}/g, comprobante.cliente?.nombre ?? 'Cliente')
            .replace(/\{\{pedido\}\}/g, pedidoRef)
            .replace(/\{\{repartidor\}\}/g, repartidorNombre ?? 'Sin asignar')
            .replace(/\{\{empresa\}\}/g, empresa?.razonSocial ?? '');

        await this.whatsapp.enviarTexto(telefono, mensaje);
    }

    async actualizarSaldo(comprobanteId: number, empresaId: number, saldo: number): Promise<void> {
        const comprobante = await this.prisma.comprobante.findFirst({
            where: { id: comprobanteId, empresaId },
            select: { id: true, mtoImpVenta: true },
        });
        if (!comprobante) throw new NotFoundException('Comprobante no encontrado');
        const nuevoSaldo = Math.max(Math.min(saldo, Number(comprobante.mtoImpVenta)), 0);
        const estadoPago = nuevoSaldo <= 0 ? 'COMPLETADO' : 'PAGO_PARCIAL';
        await this.prisma.comprobante.update({
            where: { id: comprobanteId },
            data: { saldo: nuevoSaldo, estadoPago },
        });
    }

    async confirmarPago(comprobanteId: number, empresaId: number): Promise<void> {
        const comprobante = await this.prisma.comprobante.findFirst({
            where: { id: comprobanteId, empresaId },
            select: {
                id: true, serie: true, correlativo: true, saldo: true,
                cliente: { select: { nombre: true, telefono: true } },
            },
        });
        if (!comprobante) throw new NotFoundException('Comprobante no encontrado');

        await this.prisma.comprobante.update({
            where: { id: comprobanteId },
            data: { saldo: 0, estadoPago: 'COMPLETADO' },
        });

        const telefono = comprobante.cliente?.telefono;
        if (telefono) {
            const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { razonSocial: true } });
            const pedidoRef = `${comprobante.serie}-${String(comprobante.correlativo).padStart(8, '0')}`;
            const msg = `Hola ${comprobante.cliente?.nombre ?? 'Cliente'}! ✅ Tu pago fue confirmado. Ya puedes retirar tu pedido ${pedidoRef} de la agencia. ¡Gracias por tu compra! — ${empresa?.razonSocial ?? ''}`;
            this.whatsapp.enviarTexto(telefono, msg).catch((e) => this.logger.warn(`WA pago completo fallido: ${e.message}`));
        }
    }

    private async resolveUsuarioNombre(usuarioId?: number): Promise<string | null> {
        if (!usuarioId) return null;
        const u = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nombre: true } });
        return u?.nombre ?? null;
    }

    private pickFields(dto: CreateEnvioDespachoDto) {
        const result: Record<string, any> = {};
        for (const key of DESPACHO_FIELDS) {
            if ((dto as any)[key] !== undefined) result[key] = (dto as any)[key];
        }
        return result;
    }

    private async validateComprobante(comprobanteId: number, empresaId: number) {
        const comprobante = await this.prisma.comprobante.findFirst({
            where: { id: comprobanteId, empresaId },
            include: { cliente: { select: { direccion: true, telefono: true } } },
        });
        if (!comprobante) throw new NotFoundException('Comprobante no encontrado.');
        return comprobante;
    }

    private async syncPedidoTiendaByComprobante(comprobanteId: number, estado: EstadoDespacho) {
        const mapped = DESPACHO_TO_PEDIDO_ESTADO[estado];
        if (!mapped) return;
        await this.prisma.pedidoTienda.updateMany({
            where: { comprobanteId },
            data: mapped,
        });
    }

    private withLegacyRepartidor<T>(envio: T): T {
        if (!envio) return envio;
        const data = envio as any;
        return {
            ...data,
            repartidor: data.repartidor?.nombre ?? null,
            repartidorData: data.repartidor ?? null,
        };
    }
}
