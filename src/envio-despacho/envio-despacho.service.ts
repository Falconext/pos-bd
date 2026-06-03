import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEnvioDespachoDto, UpdateEnvioDespachoDto, EstadoDespacho } from './dto/envio-despacho.dto';

const DESPACHO_FIELDS = [
    'transportista', 'codigoGuia', 'observaciones', 'direccionDestino',
    'tipoEnvio', 'agenciaDestino', 'celularDest', 'nroPaquetes',
    'turnoEnvio', 'tipoMercaderia', 'claveEnvio', 'nroOrden', 'claveOrden',
    'establecimiento', 'repartidor', 'empaquetador',
] as const;

@Injectable()
export class EnvioDespachoService {
    constructor(private prisma: PrismaService) {}

    async getByComprobante(comprobanteId: number, empresaId: number) {
        await this.validateComprobante(comprobanteId, empresaId);
        return this.prisma.envioDespacho.findUnique({ where: { comprobanteId } });
    }

    async create(comprobanteId: number, empresaId: number, dto: CreateEnvioDespachoDto) {
        const comprobante = await this.validateComprobante(comprobanteId, empresaId);
        const existing = await this.prisma.envioDespacho.findUnique({ where: { comprobanteId } });
        if (existing) throw new BadRequestException('Este comprobante ya tiene un seguimiento de despacho.');

        const estadoInicial: EstadoDespacho = dto.estado ?? EstadoDespacho.PREPARANDO;
        const historial = [{ estado: estadoInicial, fecha: new Date().toISOString(), nota: 'Despacho creado' }];

        return this.prisma.envioDespacho.create({
            data: {
                comprobanteId,
                estado: estadoInicial,
                historial,
                direccionDestino: dto.direccionDestino ?? comprobante.cliente?.direccion ?? null,
                fechaEstimada: dto.fechaEstimada ? new Date(dto.fechaEstimada) : null,
                ...this.pickFields(dto),
            },
        });
    }

    async upsert(comprobanteId: number, empresaId: number, dto: CreateEnvioDespachoDto) {
        const existing = await this.prisma.envioDespacho.findUnique({ where: { comprobanteId } });
        if (existing) return this.update(comprobanteId, empresaId, dto);
        return this.create(comprobanteId, empresaId, dto);
    }

    async update(comprobanteId: number, empresaId: number, dto: UpdateEnvioDespachoDto) {
        await this.validateComprobante(comprobanteId, empresaId);
        const envio = await this.prisma.envioDespacho.findUnique({ where: { comprobanteId } });
        if (!envio) throw new NotFoundException('No existe seguimiento de despacho para este comprobante.');

        let historial: any[] = Array.isArray(envio.historial) ? (envio.historial as any[]) : [];
        if (dto.estado && dto.estado !== envio.estado) {
            historial = [...historial, { estado: dto.estado, fecha: new Date().toISOString(), nota: dto.observaciones ?? null }];
        }

        return this.prisma.envioDespacho.update({
            where: { comprobanteId },
            data: {
                ...(dto.estado !== undefined && { estado: dto.estado as any }),
                ...(dto.fechaEstimada !== undefined && { fechaEstimada: new Date(dto.fechaEstimada) }),
                historial,
                ...this.pickFields(dto),
            },
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
                            cliente: { select: { nombre: true, telefono: true, nroDoc: true } },
                            usuario: { select: { nombre: true } },
                        },
                    },
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
                    total: true, agenciaEnvio: true, estadoEnvio: true,
                    estadoEntrega: true, creadoEn: true,
                    items: { select: { cantidad: true, precioUnit: true, producto: { select: { descripcion: true } } } },
                },
            }),
        ]);

        const despachosNormalizados = despachos.map((d) => ({
            tipo: 'COMPROBANTE' as const,
            id: d.id,
            comprobanteId: d.comprobanteId,
            referencia: `${d.comprobante.serie}-${String(d.comprobante.correlativo).padStart(8, '0')}`,
            cliente: d.comprobante.cliente?.nombre ?? '—',
            telefono: d.comprobante.cliente?.telefono ?? '',
            vendedor: d.comprobante.usuario?.nombre ?? '—',
            total: d.comprobante.mtoImpVenta,
            courier: d.transportista ?? '—',
            tipoEnvio: d.tipoEnvio ?? '—',
            agenciaDestino: d.agenciaDestino ?? '—',
            celularDest: d.celularDest ?? '',
            nroPaquetes: d.nroPaquetes ?? 1,
            turnoEnvio: d.turnoEnvio ?? '—',
            codigoGuia: d.codigoGuia ?? '',
            estado: d.estado,
            creadoEn: d.creadoEn,
        }));

        const pedidosNormalizados = pedidos.map((p) => ({
            tipo: 'PEDIDO_TIENDA' as const,
            id: p.id,
            pedidoId: p.id,
            referencia: p.codigoSeguimiento,
            cliente: p.clienteNombre,
            telefono: p.clienteTelefono,
            vendedor: 'Tienda online',
            total: Number(p.total),
            courier: p.agenciaEnvio ?? '—',
            tipoEnvio: 'AGENCIA',
            agenciaDestino: p.clienteDireccion ?? '—',
            celularDest: p.clienteTelefono,
            nroPaquetes: 1,
            turnoEnvio: '—',
            codigoGuia: '',
            estado: p.estadoEnvio,
            creadoEn: p.creadoEn,
        }));

        const todos = [...despachosNormalizados, ...pedidosNormalizados]
            .sort((a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime());

        return { data: todos, total: todos.length };
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
}
