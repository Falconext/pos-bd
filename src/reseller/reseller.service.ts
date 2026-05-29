import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Reseller, ResellerRecarga, ResellerMovimiento, EstadoType, Prisma } from '@prisma/client'; // Import EstadoType
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { NotificacionesService } from 'src/notificaciones/notificaciones.service';
import { SedeService } from 'src/sede/sede.service';
import * as bcrypt from 'bcrypt';
import { resolveBillingProvider } from 'src/common/utils/billing-provider';

// Falconext volume-based reseller pricing (cost the platform charges the reseller per active client/month).
// Tiers: [1-5 clients, 6-15 clients, 16-30 clients, 31+ clients]
const FALCONEXT_VOLUME_PRICING: Record<string, [number, number, number, number]> = {
    'Emprendedor': [14.90, 13.90, 12.90, 11.90],
    'Negocio':     [34.90, 32.90, 29.90, 27.90],
    'Corporativo': [59.90, 56.90, 52.90, 49.90],
};

function getVolumeTierPrice(planNombre: string, clientesActivos: number): number | null {
    const prices = FALCONEXT_VOLUME_PRICING[planNombre];
    if (!prices) return null;
    if (clientesActivos <= 5)  return prices[0];
    if (clientesActivos <= 15) return prices[1];
    if (clientesActivos <= 30) return prices[2];
    return prices[3];
}

@Injectable()
export class ResellerService {
    constructor(
        private prisma: PrismaService,
        private readonly notificacionesService: NotificacionesService,
        private readonly sedeService: SedeService,
    ) { }

    private calculatePlanCostWithDiscount(planCost: number, discount: number) {
        return planCost * (1 - discount / 100);
    }

    private resolveClientCost(planNombre: string, planCosto: number, porcentajeDescuento: number, clientesActivos: number): number {
        if (process.env.RESELLER_PRICING_MODEL === 'VOLUMEN') {
            const tierPrice = getVolumeTierPrice(planNombre, clientesActivos);
            if (tierPrice !== null) return tierPrice;
        }
        return this.calculatePlanCostWithDiscount(planCosto, porcentajeDescuento);
    }

    private getTierLabel(clientesActivos: number): string {
        if (clientesActivos <= 5)  return '1-5 clientes';
        if (clientesActivos <= 15) return '6-15 clientes';
        if (clientesActivos <= 30) return '16-30 clientes';
        return '31+ clientes';
    }

    private getRenewalPolicy() {
        const graceDays = Math.max(0, Number(process.env.RESELLER_RENEWAL_GRACE_DAYS ?? 3));
        const maxRetries = Math.max(1, Number(process.env.RESELLER_RENEWAL_MAX_RETRIES ?? 3));
        return { graceDays, maxRetries };
    }

    private getDiscountPolicy() {
        const bronze = Number(process.env.RESELLER_DISCOUNT_BRONZE ?? 20);
        const silver = Number(process.env.RESELLER_DISCOUNT_SILVER ?? 30);
        const gold = Number(process.env.RESELLER_DISCOUNT_GOLD ?? 35);
        return {
            bronze: Math.max(0, bronze),
            silver: Math.max(0, silver),
            gold: Math.max(0, gold),
        };
    }

    private async notifyResellerUsers(
        tx: Prisma.TransactionClient,
        resellerId: number,
        payload: { tipo: 'INFO' | 'WARNING' | 'CRITICAL'; titulo: string; mensaje: string; empresaId?: number },
    ) {
        const users = await tx.usuario.findMany({
            where: { resellerId, rol: 'RESELLER', estado: 'ACTIVO' },
            select: { id: true },
        });

        for (const user of users) {
            await this.notificacionesService.crearNotificacion({
                usuarioId: user.id,
                empresaId: payload.empresaId,
                tipo: payload.tipo,
                titulo: payload.titulo,
                mensaje: payload.mensaje,
            });
        }
    }

    async validateResellerAccess(userId: number, role: string, resellerId: number) {
        if (role === 'ADMIN_SISTEMA') return;

        if (role !== 'RESELLER') {
            throw new ForbiddenException('No tiene permisos para acceder a este recurso.');
        }

        const user = await this.prisma.usuario.findUnique({
            where: { id: userId },
            select: { resellerId: true }
        });

        if (!user?.resellerId || user.resellerId !== resellerId) {
            throw new ForbiddenException('No tiene acceso a este distribuidor.');
        }
    }


    async create(data: {
        nombre: string;
        email: string;
        codigo: string;
        telefono?: string;
        representante?: string;
        dominioPersonalizado?: string;
        whiteLabelNombre?: string;
        whiteLabelLogoUrl?: string;
        whiteLabelLogoWhiteUrl?: string;
        whiteLabelFaviconUrl?: string;
        whiteLabelColorPrimario?: string;
        whiteLabelColorSecundario?: string;
        whiteLabelWebsite?: string;
        whiteLabelEmail?: string;
        whiteLabelTelefono?: string;
        whiteLabelWhatsapp?: string;
    }) {
        const dominioPersonalizado = String(data.dominioPersonalizado || '')
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .split('/')[0]
            .split(':')[0];

        const existing = await this.prisma.reseller.findFirst({
            where: {
                OR: [
                    { email: data.email },
                    { codigo: data.codigo },
                    ...(dominioPersonalizado ? [{ dominioPersonalizado }] : []),
                ],
            },
        });

        if (existing) {
            throw new BadRequestException('El email o código ya existe.');
        }

        // Transaction to create Reseller AND User
        return this.prisma.$transaction(async (tx) => {
            const reseller = await tx.reseller.create({
                data: {
                    ...data,
                    dominioPersonalizado: dominioPersonalizado || null,
                },
            });

            // Create User for Login
            // Must have role RESELLER
            // Check if user exists first? Email matches Reseller email.
            const userExists = await tx.usuario.findUnique({ where: { email: data.email } });
            if (userExists) {
                // If user exists, we might need to update role or throw error?
                // For simplicity, assume new user for now or throw
                throw new BadRequestException('El usuario con este email ya existe en el sistema.');
            }

            // Generate temp password (or default) - In production use email service
            const hashedPassword = await bcrypt.hash('123456', 10);

            await tx.usuario.create({
                data: {
                    nombre: data.nombre,
                    email: data.email,
                    password: hashedPassword,
                    rol: 'RESELLER',
                    estado: 'ACTIVO',
                    dni: data.codigo || '00000000', // Placeholder or use code
                    celular: data.telefono || '-', // Placeholder
                    resellerId: reseller.id, // LINK USER TO RESELLER
                    // empresaId is null for Resellers? Or we create a placeholder company?
                    // Auth logic expects company status for non-system admin.
                    // IMPORTANT: AuthService:111 Checks company status if NOT system admin. 
                    // We need to bypass this for RESELLER in Auth Service or make Reseller a System Admin type?
                    // Schema says: rol can be RESELLER.
                }
            });

            return reseller;
        });
    }

    async update(id: number, data: any) {
        return this.prisma.$transaction(async (tx) => {
            const reseller = await tx.reseller.findUnique({
                where: { id },
                select: { id: true, email: true },
            });

            if (!reseller) {
                throw new NotFoundException('Reseller no encontrado');
            }

            const nextEmail = typeof data?.email === 'string' ? data.email.trim() : undefined;
            const shouldUpdateUserEmail = !!nextEmail && nextEmail !== reseller.email;
            const nextDomainRaw = typeof data?.dominioPersonalizado === 'string'
                ? data.dominioPersonalizado
                : undefined;
            const nextDomain = nextDomainRaw
                ? nextDomainRaw
                    .trim()
                    .toLowerCase()
                    .replace(/^https?:\/\//, '')
                    .replace(/^www\./, '')
                    .split('/')[0]
                    .split(':')[0]
                : undefined;

            if (shouldUpdateUserEmail) {
                const existingUser = await tx.usuario.findFirst({
                    where: {
                        email: nextEmail,
                        NOT: { resellerId: id },
                    },
                    select: { id: true },
                });

                if (existingUser) {
                    throw new BadRequestException('El correo ya está en uso por otro usuario del sistema.');
                }

                await tx.usuario.updateMany({
                    where: { resellerId: id, rol: 'RESELLER' },
                    data: { email: nextEmail },
                });
            }

            if (nextDomain !== undefined) {
                const existingDomain = await tx.reseller.findFirst({
                    where: {
                        dominioPersonalizado: nextDomain || null,
                        NOT: { id },
                    },
                    select: { id: true },
                });
                if (existingDomain) {
                    throw new BadRequestException('El dominio personalizado ya está en uso por otro reseller.');
                }
                data.dominioPersonalizado = nextDomain || null;
            }

            return tx.reseller.update({
                where: { id },
                data,
            });
        });
    }

    async toggleActiveStatus(id: number, activo: boolean) {
        const reseller = await this.prisma.reseller.findUnique({ where: { id } });
        if (!reseller) throw new NotFoundException('Reseller no encontrado');

        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.reseller.update({
                where: { id },
                data: { activo }
            });

            await tx.usuario.updateMany({
                where: { resellerId: id, rol: 'RESELLER' },
                data: { estado: activo ? 'ACTIVO' : 'INACTIVO' }
            });

            return updated;
        });
    }

    async findAll() {
        return this.prisma.reseller.findMany({
            include: {
                _count: {
                    select: { empresas: true },
                },
            },
        });
    }

    async findOne(id: number) {
        const reseller = await this.prisma.reseller.findUnique({
            where: { id },
            include: {
                empresas: {
                    include: {
                        plan: true,
                        usuarios: {
                            where: { rol: 'ADMIN_EMPRESA' },
                            take: 1,
                            select: { id: true, email: true, nombre: true },
                        },
                    },
                },
                recargas: {
                    orderBy: { fecha: 'desc' },
                    take: 10,
                },
                movimientos: {
                    orderBy: { fecha: 'desc' },
                    take: 10,
                },
            },
        });

        if (!reseller) throw new NotFoundException('Reseller no encontrado');
        return reseller;
    }

    async recargarSaldo(resellerId: number, monto: number, usuarioId: number, referencia?: string) {
        if (monto <= 0) throw new BadRequestException('El monto debe ser positivo');

        // Logic for Tier (Discount Percentage)
        // Bronce: 100-249
        // Plata: 250-499
        // Oro: 500+
        const discounts = this.getDiscountPolicy();
        let nuevoDescuento = 0; // Base 0%
        if (monto >= 500) nuevoDescuento = discounts.gold;
        else if (monto >= 250) nuevoDescuento = discounts.silver;
        else if (monto >= 100) nuevoDescuento = discounts.bronze;

        return this.prisma.$transaction(async (tx) => {
            // 1. Crear registro de recarga
            await tx.resellerRecarga.create({
                data: {
                    resellerId,
                    monto,
                    usuarioId,
                    referencia,
                    medioPago: 'MANUAL',
                },
            });

            // 2. Actualizar saldo del reseller
            const reseller = await tx.reseller.update({
                where: { id: resellerId },
                data: {
                    saldo: { increment: monto },
                    porcentajeDescuento: nuevoDescuento
                },
            });

            // 3. Registrar movimiento (Ingreso)
            await tx.resellerMovimiento.create({
                data: {
                    resellerId,
                    tipo: 'RECARGA',
                    monto: monto,
                    descripcion: `Recarga de saldo Ref: ${referencia || 'S/N'} - Nuevo Descuento: ${nuevoDescuento}%`,
                },
            });

            return reseller;
        });
    }

    async createClient(
        resellerId: number,
        data: {
            rut: string;
            razonSocial: string;
            email: string;
            password?: string;
            representa?: string;
            celular?: string;
            planId?: number | string;
            billingProvider?: 'QPSE' | 'APISUNAT' | 'JAMBLE';
            billingApiBaseUrl?: string;
            billingApiToken?: string;
            billingApiUser?: string;
            billingApiPassword?: string;
            providerId?: string;
            providerToken?: string;
            usuarioPse?: string;
            contrasenaPse?: string;
        },
    ) {
        const inputRuc = String(data.rut || '').trim();
        const inputEmail = String(data.email || '').trim().toLowerCase();
        if (!inputRuc) throw new BadRequestException('El RUC es obligatorio.');
        if (!inputEmail) throw new BadRequestException('El email es obligatorio.');

        const empresa = await this.prisma.$transaction(async (tx) => {
            // 1. Fetch Reseller & Check Balance (Locked for safety?)
            const reseller = await tx.reseller.findUnique({ where: { id: resellerId } });
            if (!reseller) throw new NotFoundException('Reseller no encontrado');
            if (!reseller.activo) {
                throw new BadRequestException('El distribuidor está inactivo y no puede registrar nuevos clientes.');
            }

            const [existingEmpresa, existingUser] = await Promise.all([
                tx.empresa.findUnique({ where: { ruc: inputRuc }, select: { id: true } }),
                tx.usuario.findUnique({ where: { email: inputEmail }, select: { id: true } }),
            ]);
            if (existingEmpresa) {
                throw new BadRequestException('Ya existe una empresa registrada con ese RUC.');
            }
            if (existingUser) {
                throw new BadRequestException('Ya existe un usuario registrado con ese email.');
            }

            // 2. Determine Plan
            let planId = data.planId ? Number(data.planId) : null;
            let plan;
            if (!planId) {
                const defaultPlan = await tx.plan.findFirst();
                if (!defaultPlan) throw new Error('No hay planes configurados');
                plan = defaultPlan;
            } else {
                plan = await tx.plan.findUnique({ where: { id: planId } });
                if (!plan) throw new NotFoundException('Plan no encontrado');
            }

            // 3. Calculate Cost (volume-based for Falconext, percentage-based otherwise)
            const planCosto = Number(plan.costo);
            const descuento = Number((reseller as any).porcentajeDescuento) || 0;
            const clientesActuales = await tx.empresa.count({ where: { resellerId, estado: 'ACTIVO' } });
            const clientesConNuevo = clientesActuales + 1;
            const costoFinal = this.resolveClientCost(plan.nombre, planCosto, descuento, clientesConNuevo);

            if (Number(reseller.saldo) < costoFinal) {
                throw new BadRequestException(`Saldo insuficiente. El plan cuesta S/${costoFinal.toFixed(2)} y tienes S/${Number(reseller.saldo).toFixed(2)}`);
            }

            // 4. Deduct Balance
            await tx.reseller.update({
                where: { id: resellerId },
                data: { saldo: { decrement: costoFinal } }
            });

            const descripcionActivacion = process.env.RESELLER_PRICING_MODEL === 'VOLUMEN'
                ? `Activación cliente: ${data.razonSocial} - Plan: ${plan.nombre} (Tier ${this.getTierLabel(clientesConNuevo)})`
                : `Activación cliente: ${data.razonSocial} - Plan: ${plan.nombre} (${descuento}% Off)`;

            await tx.resellerMovimiento.create({
                data: {
                    resellerId,
                    tipo: 'ACTIVACION',
                    monto: -costoFinal,
                    descripcion: descripcionActivacion,
                }
            });

            const unidadMedida = await tx.unidadMedida.findFirst();
            if (!unidadMedida) {
                throw new BadRequestException('No hay unidades de medida disponibles en el sistema');
            }

            const requestedProvider = String(data.billingProvider || '').toUpperCase();
            const billingProvider = (
                requestedProvider === 'QPSE' ||
                requestedProvider === 'APISUNAT' ||
                requestedProvider === 'JAMBLE'
            ) ? requestedProvider : 'QPSE';

            if (billingProvider === 'APISUNAT') {
                if (!data.providerId || !data.providerToken) {
                    throw new BadRequestException('Para APISUNAT debes enviar providerId y providerToken.');
                }
            }

            if (billingProvider === 'QPSE') {
                if (!data.usuarioPse || !data.contrasenaPse) {
                    throw new BadRequestException('Para QPSE debes enviar usuarioPse y contrasenaPse.');
                }
            }

            if (billingProvider === 'JAMBLE') {
                const hasToken = !!String(data.billingApiToken || '').trim();
                const hasBasicAuth = !!String(data.billingApiUser || '').trim() && !!String(data.billingApiPassword || '').trim();
                if (!data.billingApiBaseUrl || (!hasToken && !hasBasicAuth)) {
                    throw new BadRequestException(
                        'Para JAMBLE debes enviar billingApiBaseUrl y token o usuario/clave API.',
                    );
                }
            }

            // 5. Create Empresa
            const empresa = await tx.empresa.create({
                data: {
                    ruc: inputRuc, // RUC logic
                    razonSocial: data.razonSocial,
                    nombreComercial: data.razonSocial,
                    direccion: '-',
                    fechaActivacion: new Date(),
                    fechaExpiracion: new Date(new Date().setDate(new Date().getDate() + 30)), // 30 days
                    planId: plan.id,
                    resellerId: resellerId,
                    billingProvider: billingProvider as any,
                    billingApiBaseUrl: data.billingApiBaseUrl || null,
                    billingApiToken: data.billingApiToken || null,
                    billingApiUser: data.billingApiUser || null,
                    billingApiPassword: data.billingApiPassword || null,
                    providerId: data.providerId || null,
                    providerToken: data.providerToken || null,
                    usuarioPse: data.usuarioPse || null,
                    contrasenaPse: data.contrasenaPse || null,
                    usaDemo: billingProvider === 'APISUNAT',
                    slugTienda: inputRuc + Math.floor(Math.random() * 1000), // Temp slug
                    costoActivacionReseller: costoFinal,
                    clientes: {
                        create: {
                            nombre: 'CLIENTES VARIOS',
                            nroDoc: '10000000',
                            estado: 'ACTIVO',
                            tipoDocumento: { connect: { codigo: '1' } },
                        },
                    },
                    productos: {
                        create: [
                            {
                                codigo: 'DGD',
                                descripcion: 'Descuento global',
                                unidadMedidaId: unidadMedida.id,
                                precioUnitario: 0,
                                valorUnitario: 0,
                                igvPorcentaje: 0,
                                stock: 0,
                                tipoAfectacionIGV: '10',
                                estado: 'INACTIVO',
                            },
                            {
                                codigo: 'IPM',
                                descripcion: 'Interes por mora',
                                unidadMedidaId: unidadMedida.id,
                                precioUnitario: 0,
                                valorUnitario: 0,
                                igvPorcentaje: 0,
                                stock: 0,
                                tipoAfectacionIGV: '10',
                                estado: 'INACTIVO',
                            },
                            {
                                codigo: 'PLD',
                                descripcion: 'Penalidad',
                                unidadMedidaId: unidadMedida.id,
                                precioUnitario: 0,
                                valorUnitario: 0,
                                igvPorcentaje: 0,
                                stock: 0,
                                tipoAfectacionIGV: '10',
                                estado: 'INACTIVO',
                            },
                        ],
                    },
                } as any,
            });

            // 6. Create User (Admin Empresa)
            const hashedPassword = await bcrypt.hash(data.password || '123456', 10);
            await tx.usuario.create({
                data: {
                    nombre: data.representa || 'Administrador',
                    email: inputEmail,
                    password: hashedPassword,
                    rol: 'ADMIN_EMPRESA',
                    empresaId: empresa.id,
                    dni: '-',
                    celular: data.celular || '-'
                }
            });

            return empresa;
        }).catch((error: unknown) => {
            if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new BadRequestException('No se pudo crear el cliente porque ya existe un dato único (RUC, email o slug).');
            }
            throw error;
        });

        await this.sedeService.create({
            nombre: 'Sede Principal',
            direccion: empresa.direccion || '-',
            codigo: '001',
            esPrincipal: true,
        }, empresa.id);

        return empresa;
    }

    async getProfitabilityOverview(days = 30) {
        const now = new Date();
        const periodStart = new Date(now);
        periodStart.setDate(periodStart.getDate() - Math.max(1, days));

        const [resellers, rejectedRenewals, appliedRenewals] = await Promise.all([
            this.prisma.reseller.findMany({
                include: {
                    empresas: {
                        where: { estado: 'ACTIVO' },
                        select: {
                            id: true,
                            plan: { select: { costo: true } },
                        },
                    },
                },
                orderBy: { creadoEn: 'desc' },
            }),
            this.prisma.resellerMovimiento.findMany({
                where: {
                    tipo: 'MENSUALIDAD',
                    estado: 'RECHAZADO',
                    fecha: { gte: periodStart },
                    empresaId: { not: null },
                },
                select: {
                    resellerId: true,
                    empresaId: true,
                },
            }),
            this.prisma.resellerMovimiento.groupBy({
                by: ['resellerId'],
                where: {
                    tipo: 'MENSUALIDAD',
                    estado: 'APLICADO',
                    fecha: { gte: periodStart },
                },
                _sum: { monto: true },
                _count: { _all: true },
            }),
        ]);

        const rejectedMap = new Map<number, Set<number>>();
        for (const item of rejectedRenewals) {
            if (!item.empresaId) continue;
            if (!rejectedMap.has(item.resellerId)) {
                rejectedMap.set(item.resellerId, new Set<number>());
            }
            rejectedMap.get(item.resellerId)!.add(item.empresaId);
        }

        const appliedMap = new Map(
            appliedRenewals.map((item) => [
                item.resellerId,
                {
                    totalCobrado: Math.abs(Number(item._sum.monto ?? 0)),
                    renovacionesAplicadas: item._count._all,
                },
            ])
        );

        return resellers.map((reseller) => {
            const clientesActivos = reseller.empresas.length;
            const mrrBruto = reseller.empresas.reduce((acc, empresa) => acc + Number(empresa.plan.costo), 0);
            const descuento = Number(reseller.porcentajeDescuento) || 0;
            const mrrNeto = this.calculatePlanCostWithDiscount(mrrBruto, descuento);
            const margenMensual = mrrBruto - mrrNeto;
            const margenPct = mrrBruto > 0 ? (margenMensual / mrrBruto) * 100 : 0;

            const clientesPerdidos30d = rejectedMap.get(reseller.id)?.size ?? 0;
            const baseCartera = clientesActivos + clientesPerdidos30d;
            const churn30dPct = baseCartera > 0 ? (clientesPerdidos30d / baseCartera) * 100 : 0;

            const applied = appliedMap.get(reseller.id) ?? { totalCobrado: 0, renovacionesAplicadas: 0 };

            return {
                resellerId: reseller.id,
                clientesActivos,
                mrrBruto,
                mrrNeto,
                margenMensual,
                margenPct,
                churn30dPct,
                clientesPerdidos30d,
                renovacionesAplicadas30d: applied.renovacionesAplicadas,
                cobradoRenovaciones30d: applied.totalCobrado,
            };
        });
    }

    async processMonthlyRenewals() {
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const { graceDays, maxRetries } = this.getRenewalPolicy();

        const vencidas = await this.prisma.empresa.findMany({
            where: {
                resellerId: { not: null },
                fechaExpiracion: { lte: now },
                estado: { in: ['ACTIVO', 'INACTIVO'] },
            },
            select: {
                id: true,
                razonSocial: true,
                fechaExpiracion: true,
                resellerId: true,
                plan: { select: { id: true, nombre: true, costo: true } },
            },
            orderBy: { fechaExpiracion: 'asc' },
        });

        let renovadas = 0;
        let suspendidas = 0;

        for (const empresa of vencidas) {
            if (!empresa.resellerId) continue;

            await this.prisma.$transaction(async (tx) => {
                const movimientoHoy = await tx.resellerMovimiento.findFirst({
                    where: {
                        resellerId: empresa.resellerId!,
                        empresaId: empresa.id,
                        tipo: 'MENSUALIDAD',
                        fecha: { gte: startOfDay },
                    },
                });

                if (movimientoHoy) return;

                const ultimoIntento = await tx.resellerMovimiento.findFirst({
                    where: {
                        resellerId: empresa.resellerId!,
                        empresaId: empresa.id,
                        tipo: 'MENSUALIDAD',
                    },
                    orderBy: { fecha: 'desc' },
                    select: { intento: true },
                });

                const intentoActual = (ultimoIntento?.intento ?? 0) + 1;

                const reseller = await tx.reseller.findUnique({
                    where: { id: empresa.resellerId! },
                    select: { id: true, saldo: true, porcentajeDescuento: true }
                });

                if (!reseller) return;

                const planCosto = Number(empresa.plan.costo);
                const descuento = Number(reseller.porcentajeDescuento) || 0;
                const clientesActivos = await tx.empresa.count({ where: { resellerId: reseller.id, estado: 'ACTIVO' } });
                const costoFinal = this.resolveClientCost(empresa.plan.nombre, planCosto, descuento, clientesActivos);
                const saldoActual = Number(reseller.saldo);
                const diasVencida = Math.max(0, Math.floor((now.getTime() - empresa.fechaExpiracion.getTime()) / (1000 * 60 * 60 * 24)));
                const enGracia = diasVencida <= graceDays;

                if (saldoActual >= costoFinal) {
                    const baseFecha = empresa.fechaExpiracion > now ? new Date(empresa.fechaExpiracion) : new Date(now);
                    const nuevaFechaExpiracion = new Date(baseFecha);
                    nuevaFechaExpiracion.setDate(nuevaFechaExpiracion.getDate() + 30);

                    await tx.reseller.update({
                        where: { id: reseller.id },
                        data: { saldo: { decrement: costoFinal } }
                    });

                    await tx.empresa.update({
                        where: { id: empresa.id },
                        data: {
                            fechaExpiracion: nuevaFechaExpiracion,
                            estado: 'ACTIVO'
                        }
                    });

                    await tx.resellerMovimiento.create({
                        data: {
                            resellerId: reseller.id,
                            empresaId: empresa.id,
                            tipo: 'MENSUALIDAD',
                            monto: -costoFinal,
                            estado: 'APLICADO',
                            intento: intentoActual,
                            descripcion: process.env.RESELLER_PRICING_MODEL === 'VOLUMEN'
                                ? `Renovación mensual cliente: ${empresa.razonSocial} - Plan: ${empresa.plan.nombre} (Tier ${this.getTierLabel(clientesActivos)})`
                                : `Renovación mensual cliente: ${empresa.razonSocial} - Plan: ${empresa.plan.nombre} (${descuento}% Off)`,
                        }
                    });

                    await this.notifyResellerUsers(tx, reseller.id, {
                        empresaId: empresa.id,
                        tipo: 'INFO',
                        titulo: 'Renovación aplicada',
                        mensaje: `Se renovó ${empresa.razonSocial} por S/${costoFinal.toFixed(2)}. Nuevo vencimiento: ${nuevaFechaExpiracion.toLocaleDateString('es-PE')}.`,
                    });

                    renovadas += 1;
                    return;
                }

                if (enGracia && intentoActual <= maxRetries) {
                    await tx.resellerMovimiento.create({
                        data: {
                            resellerId: reseller.id,
                            empresaId: empresa.id,
                            tipo: 'MENSUALIDAD',
                            monto: 0,
                            estado: 'PENDIENTE',
                            intento: intentoActual,
                            motivo: 'SALDO_INSUFICIENTE',
                            descripcion: `Renovación pendiente por saldo insuficiente: ${empresa.razonSocial}. Intento ${intentoActual}/${maxRetries}.`,
                        }
                    });

                    await this.notifyResellerUsers(tx, reseller.id, {
                        empresaId: empresa.id,
                        tipo: 'WARNING',
                        titulo: 'Renovación pendiente',
                        mensaje: `No se pudo renovar ${empresa.razonSocial} por saldo insuficiente. Intento ${intentoActual}/${maxRetries}. Días de gracia restantes: ${Math.max(0, graceDays - diasVencida)}.`,
                    });

                    return;
                }

                await tx.empresa.update({
                    where: { id: empresa.id },
                    data: { estado: 'INACTIVO' }
                });

                await tx.resellerMovimiento.create({
                    data: {
                        resellerId: reseller.id,
                        empresaId: empresa.id,
                        tipo: 'MENSUALIDAD',
                        monto: 0,
                        estado: 'RECHAZADO',
                        intento: intentoActual,
                        motivo: 'SALDO_INSUFICIENTE',
                        descripcion: `No renovado por saldo insuficiente: ${empresa.razonSocial} - Plan: ${empresa.plan.nombre}. Cliente suspendido.`,
                    }
                });

                await this.notifyResellerUsers(tx, reseller.id, {
                    empresaId: empresa.id,
                    tipo: 'CRITICAL',
                    titulo: 'Cliente suspendido por falta de saldo',
                    mensaje: `${empresa.razonSocial} fue suspendido por no renovar dentro del periodo de gracia o por superar intentos de cobro.`,
                });

                suspendidas += 1;
            });
        }

        return {
            totalEvaluadas: vencidas.length,
            renovadas,
            suspendidas,
        };
    }

    async getDashboardStats(resellerId: number) {
        const reseller = await this.prisma.reseller.findUnique({
            where: { id: resellerId },
            select: {
                saldo: true,
                _count: {
                    select: { empresas: true },
                },
            },
        });

        if (!reseller) throw new NotFoundException('Reseller no encontrado');

        // Count suspended vs active clients if needed
        const clientesActivos = await this.prisma.empresa.count({
            where: { resellerId, estado: 'ACTIVO' },
        });

        const clientesSuspendidos = await this.prisma.empresa.count({
            where: { resellerId, estado: { not: 'ACTIVO' } },
        });

        return {
            saldo: reseller.saldo,
            totalClientes: reseller._count.empresas,
            clientesActivos,
            clientesSuspendidos,
        };
    }

    async getRenewalMovements(resellerId: number, estado?: string) {
        const where: any = {
            resellerId,
            tipo: 'MENSUALIDAD',
        };

        if (estado && ['APLICADO', 'PENDIENTE', 'RECHAZADO'].includes(estado)) {
            where.estado = estado;
        }

        const movimientos = await this.prisma.resellerMovimiento.findMany({
            where,
            include: {
                empresa: {
                    select: {
                        id: true,
                        razonSocial: true,
                        ruc: true,
                        fechaExpiracion: true,
                        estado: true,
                    },
                },
            },
            orderBy: { fecha: 'desc' },
            take: 100,
        });

        const [aplicados, pendientes, rechazados] = await Promise.all([
            this.prisma.resellerMovimiento.count({ where: { resellerId, tipo: 'MENSUALIDAD', estado: 'APLICADO' } }),
            this.prisma.resellerMovimiento.count({ where: { resellerId, tipo: 'MENSUALIDAD', estado: 'PENDIENTE' } }),
            this.prisma.resellerMovimiento.count({ where: { resellerId, tipo: 'MENSUALIDAD', estado: 'RECHAZADO' } }),
        ]);

        return {
            movimientos,
            resumen: {
                aplicados,
                pendientes,
                rechazados,
                total: aplicados + pendientes + rechazados,
            },
        };
    }

    async getEstadoCuenta(
        resellerId: number,
        filtros?: {
            desde?: string;
            hasta?: string;
            tipo?: string;
            estado?: string;
            page?: number;
            limit?: number;
        },
    ) {
        const reseller = await this.prisma.reseller.findUnique({
            where: { id: resellerId },
            select: {
                id: true,
                nombre: true,
                codigo: true,
                saldo: true,
            },
        });

        if (!reseller) throw new NotFoundException('Reseller no encontrado');

        const now = new Date();
        const desdeDate = filtros?.desde ? new Date(`${filtros.desde}T00:00:00.000Z`) : new Date(now.getFullYear(), now.getMonth(), 1);
        const hastaDate = filtros?.hasta ? new Date(`${filtros.hasta}T23:59:59.999Z`) : now;
        if (Number.isNaN(desdeDate.getTime()) || Number.isNaN(hastaDate.getTime())) {
            throw new BadRequestException('Rango de fechas inválido.');
        }

        const page = Number.isFinite(Number(filtros?.page)) && Number(filtros?.page) > 0 ? Number(filtros?.page) : 1;
        const limitRaw = Number.isFinite(Number(filtros?.limit)) && Number(filtros?.limit) > 0 ? Number(filtros?.limit) : 50;
        const limit = Math.min(limitRaw, 200);
        const skip = (page - 1) * limit;

        const allowedTypes = new Set(['RECARGA', 'ACTIVACION', 'MENSUALIDAD', 'DEVOLUCION']);
        const allowedStatus = new Set(['APLICADO', 'PENDIENTE', 'RECHAZADO']);
        const tipo = String(filtros?.tipo || '').toUpperCase();
        const estado = String(filtros?.estado || '').toUpperCase();

        const whereMov: Prisma.ResellerMovimientoWhereInput = {
            resellerId,
            fecha: {
                gte: desdeDate,
                lte: hastaDate,
            },
        };

        if (tipo && allowedTypes.has(tipo)) whereMov.tipo = tipo;
        if (estado && allowedStatus.has(estado)) whereMov.estado = estado;

        const [movimientos, totalMovimientos, recargas, resumenRaw] = await Promise.all([
            this.prisma.resellerMovimiento.findMany({
                where: whereMov,
                include: {
                    empresa: {
                        select: {
                            id: true,
                            ruc: true,
                            razonSocial: true,
                            estado: true,
                            plan: {
                                select: {
                                    id: true,
                                    nombre: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { fecha: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.resellerMovimiento.count({ where: whereMov }),
            this.prisma.resellerRecarga.findMany({
                where: {
                    resellerId,
                    fecha: {
                        gte: desdeDate,
                        lte: hastaDate,
                    },
                },
                orderBy: { fecha: 'desc' },
                take: 200,
            }),
            this.prisma.resellerMovimiento.groupBy({
                by: ['tipo', 'estado'],
                where: {
                    resellerId,
                    fecha: {
                        gte: desdeDate,
                        lte: hastaDate,
                    },
                },
                _sum: {
                    monto: true,
                },
                _count: {
                    _all: true,
                },
            }),
        ]);

        const resumen = {
            recargas: {
                total: 0,
                cantidad: 0,
            },
            activaciones: {
                cobrado: 0,
                cantidad: 0,
            },
            mensualidades: {
                cobrado: 0,
                aplicadas: 0,
                pendientes: 0,
                rechazadas: 0,
            },
            devoluciones: {
                total: 0,
                cantidad: 0,
            },
        };

        for (const row of resumenRaw) {
            const sum = Number(row._sum.monto || 0);
            const count = Number(row._count._all || 0);
            if (row.tipo === 'RECARGA') {
                resumen.recargas.total += sum;
                resumen.recargas.cantidad += count;
            }
            if (row.tipo === 'ACTIVACION') {
                resumen.activaciones.cobrado += Math.abs(sum);
                resumen.activaciones.cantidad += count;
            }
            if (row.tipo === 'MENSUALIDAD') {
                if (row.estado === 'APLICADO') {
                    resumen.mensualidades.cobrado += Math.abs(sum);
                    resumen.mensualidades.aplicadas += count;
                } else if (row.estado === 'PENDIENTE') {
                    resumen.mensualidades.pendientes += count;
                } else if (row.estado === 'RECHAZADO') {
                    resumen.mensualidades.rechazadas += count;
                }
            }
            if (row.tipo === 'DEVOLUCION') {
                resumen.devoluciones.total += sum;
                resumen.devoluciones.cantidad += count;
            }
        }

        const totalCobrado = resumen.activaciones.cobrado + resumen.mensualidades.cobrado;
        const flujoNeto = resumen.recargas.total + resumen.devoluciones.total - totalCobrado;

        return {
            reseller: {
                id: reseller.id,
                nombre: reseller.nombre,
                codigo: reseller.codigo,
                saldoActual: Number(reseller.saldo),
            },
            periodo: {
                desde: desdeDate,
                hasta: hastaDate,
            },
            resumen: {
                ...resumen,
                totalCobrado,
                flujoNeto,
            },
            paginacion: {
                page,
                limit,
                total: totalMovimientos,
                totalPages: Math.max(1, Math.ceil(totalMovimientos / limit)),
            },
            movimientos: movimientos.map((mov) => ({
                id: mov.id,
                tipo: mov.tipo,
                estado: mov.estado,
                monto: Number(mov.monto),
                fecha: mov.fecha,
                intento: mov.intento,
                motivo: mov.motivo,
                descripcion: mov.descripcion,
                empresa: mov.empresa,
            })),
            recargas: recargas.map((recarga) => ({
                id: recarga.id,
                fecha: recarga.fecha,
                monto: Number(recarga.monto),
                medioPago: recarga.medioPago,
                referencia: recarga.referencia,
                observacion: recarga.observacion,
            })),
        };
    }

    async getClientDetails(resellerId: number, empresaId: number) {
        // Verify ownership
        const empresa = await this.prisma.empresa.findFirst({
            where: { id: empresaId, resellerId },
            include: {
                plan: true,
                usuarios: {
                    where: { rol: 'ADMIN_EMPRESA' },
                    take: 1
                }
            }
        });

        if (!empresa) throw new NotFoundException('Cliente no encontrado o no pertenece a este distribuidor');

        return empresa;
    }

    async toggleClientStatus(resellerId: number, empresaId: number, nuevoEstado: 'ACTIVO' | 'INACTIVO') {
        const empresa = await this.prisma.empresa.findFirst({
            where: { id: empresaId, resellerId }
        });

        if (!empresa) throw new NotFoundException('Cliente no encontrado');

        return this.prisma.empresa.update({
            where: { id: empresaId },
            data: { estado: nuevoEstado as EstadoType }
        });
    }

    async updateClientConfig(
        resellerId: number,
        empresaId: number,
        data: {
            billingProvider?: 'QPSE' | 'APISUNAT' | 'JAMBLE';
            billingApiBaseUrl?: string | null;
            billingApiToken?: string | null;
            billingApiUser?: string | null;
            billingApiPassword?: string | null;
            providerId?: string | null;
            providerToken?: string | null;
            usuarioPse?: string | null;
            contrasenaPse?: string | null;
            adminNombre?: string;
            adminEmail?: string;
            adminCelular?: string;
            adminPassword?: string;
        },
    ) {
        const empresa = await this.prisma.empresa.findFirst({
            where: { id: empresaId, resellerId },
            include: {
                usuarios: {
                    where: { rol: 'ADMIN_EMPRESA' },
                    take: 1,
                },
            },
        });

        if (!empresa) {
            throw new NotFoundException('Cliente no encontrado o no pertenece a este distribuidor');
        }

        return this.prisma.$transaction(async (tx) => {
            const updateEmpresa: Prisma.EmpresaUpdateInput = {};

            if (data.billingProvider !== undefined) {
                const provider = String(data.billingProvider || '').toUpperCase();
                if (!['QPSE', 'APISUNAT', 'JAMBLE'].includes(provider)) {
                    throw new BadRequestException('billingProvider inválido.');
                }
                updateEmpresa.billingProvider = provider as any;
                updateEmpresa.usaDemo = provider === 'APISUNAT';
            }

            if (data.billingApiBaseUrl !== undefined) updateEmpresa.billingApiBaseUrl = data.billingApiBaseUrl || null;
            if (data.billingApiToken !== undefined) updateEmpresa.billingApiToken = data.billingApiToken || null;
            if (data.billingApiUser !== undefined) updateEmpresa.billingApiUser = data.billingApiUser || null;
            if (data.billingApiPassword !== undefined) updateEmpresa.billingApiPassword = data.billingApiPassword || null;
            if (data.providerId !== undefined) updateEmpresa.providerId = data.providerId || null;
            if (data.providerToken !== undefined) updateEmpresa.providerToken = data.providerToken || null;
            if (data.usuarioPse !== undefined) updateEmpresa.usuarioPse = data.usuarioPse || null;
            if (data.contrasenaPse !== undefined) updateEmpresa.contrasenaPse = data.contrasenaPse || null;

            const updatedEmpresa = Object.keys(updateEmpresa).length
                ? await tx.empresa.update({
                    where: { id: empresaId },
                    data: updateEmpresa,
                })
                : empresa;

            const admin = empresa.usuarios?.[0];
            if (admin && (data.adminNombre !== undefined || data.adminEmail !== undefined || data.adminCelular !== undefined || data.adminPassword)) {
                const updateAdmin: Prisma.UsuarioUpdateInput = {};
                if (data.adminNombre !== undefined) updateAdmin.nombre = data.adminNombre;
                if (data.adminEmail !== undefined) updateAdmin.email = data.adminEmail;
                if (data.adminCelular !== undefined) updateAdmin.celular = data.adminCelular;
                if (data.adminPassword) updateAdmin.password = await bcrypt.hash(data.adminPassword, 10);

                await tx.usuario.update({
                    where: { id: admin.id },
                    data: updateAdmin,
                });
            }

            const finalProvider = resolveBillingProvider(updatedEmpresa as any);
            if (finalProvider === 'APISUNAT' && (!updatedEmpresa.providerId || !updatedEmpresa.providerToken)) {
                throw new BadRequestException('APISUNAT requiere providerId y providerToken.');
            }
            if (finalProvider === 'QPSE' && (!updatedEmpresa.usuarioPse || !updatedEmpresa.contrasenaPse)) {
                throw new BadRequestException('QPSE requiere usuarioPse y contrasenaPse.');
            }
            if (
                finalProvider === 'JAMBLE' &&
                (
                    !updatedEmpresa.billingApiBaseUrl ||
                    (!updatedEmpresa.billingApiToken && !(updatedEmpresa.billingApiUser && updatedEmpresa.billingApiPassword))
                )
            ) {
                throw new BadRequestException('JAMBLE requiere billingApiBaseUrl y token o usuario/clave.');
            }

            return tx.empresa.findUnique({
                where: { id: empresaId },
                include: {
                    plan: true,
                    usuarios: {
                        where: { rol: 'ADMIN_EMPRESA' },
                        take: 1,
                        select: { id: true, nombre: true, email: true, celular: true },
                    },
                },
            });
        });
    }

    async updateClient(
        resellerId: number,
        empresaId: number,
        data: {
            planId?: number;
            telefono?: string;
            razonSocial?: string;
            adminEmail?: string;
            adminPassword?: string;
        },
    ) {
        const empresa = await this.prisma.empresa.findFirst({
            where: { id: empresaId, resellerId },
            include: { plan: true, usuarios: { where: { rol: 'ADMIN_EMPRESA' }, take: 1 } },
        });
        if (!empresa) throw new NotFoundException('Cliente no encontrado o no pertenece a este distribuidor');

        return this.prisma.$transaction(async (tx) => {
            const updateEmpresa: Prisma.EmpresaUpdateInput = {};
            if (data.planId && data.planId !== empresa.planId) updateEmpresa.plan = { connect: { id: data.planId } };
            if (data.razonSocial !== undefined) updateEmpresa.razonSocial = data.razonSocial;
            if (data.telefono !== undefined) updateEmpresa.whatsappTienda = data.telefono;

            if (Object.keys(updateEmpresa).length) {
                await tx.empresa.update({ where: { id: empresaId }, data: updateEmpresa });
            }

            const admin = empresa.usuarios?.[0];
            if (admin) {
                const updateAdmin: Prisma.UsuarioUpdateInput = {};
                if (data.adminEmail !== undefined) updateAdmin.email = data.adminEmail;
                if (data.telefono !== undefined) updateAdmin.celular = data.telefono;
                if (data.adminPassword) updateAdmin.password = await bcrypt.hash(data.adminPassword, 10);
                if (Object.keys(updateAdmin).length) {
                    await tx.usuario.update({ where: { id: admin.id }, data: updateAdmin });
                }
            }

            return tx.empresa.findUnique({
                where: { id: empresaId },
                include: { plan: true, usuarios: { where: { rol: 'ADMIN_EMPRESA' }, take: 1, select: { id: true, nombre: true, email: true } } },
            });
        });
    }
}
