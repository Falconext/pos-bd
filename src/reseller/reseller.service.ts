import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Reseller, ResellerRecarga, ResellerMovimiento, EstadoType, Prisma } from '@prisma/client'; // Import EstadoType
import { NotificacionesService } from 'src/notificaciones/notificaciones.service';
import { SedeService } from 'src/sede/sede.service';

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


    async create(data: { nombre: string; email: string; codigo: string; telefono?: string; representante?: string }) {
        const existing = await this.prisma.reseller.findFirst({
            where: {
                OR: [{ email: data.email }, { codigo: data.codigo }],
            },
        });

        if (existing) {
            throw new BadRequestException('El email o código ya existe.');
        }

        // Transaction to create Reseller AND User
        return this.prisma.$transaction(async (tx) => {
            const reseller = await tx.reseller.create({
                data,
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
            const hashedPassword = await import('bcrypt').then(m => m.hash('123456', 10));

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

    async createClient(resellerId: number, data: { rut: string; razonSocial: string; email: string; password?: string; representa?: string; celular?: string; planId?: number | string }) {
        const empresa = await this.prisma.$transaction(async (tx) => {
            // 1. Fetch Reseller & Check Balance (Locked for safety?)
            const reseller = await tx.reseller.findUnique({ where: { id: resellerId } });
            if (!reseller) throw new NotFoundException('Reseller no encontrado');
            if (!reseller.activo) {
                throw new BadRequestException('El distribuidor está inactivo y no puede registrar nuevos clientes.');
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

            // 3. Calculate Cost
            // Cost = Plan.costo * (1 - porcentajeDescuento / 100)
            // Default Plan Costo is Decimal. Reseller Discount is Decimal.
            const planCosto = Number(plan.costo);
            const descuento = Number((reseller as any).porcentajeDescuento) || 0;
            const costoFinal = this.calculatePlanCostWithDiscount(planCosto, descuento);

            if (Number(reseller.saldo) < costoFinal) {
                throw new BadRequestException(`Saldo insuficiente. El plan cuesta S/${costoFinal.toFixed(2)} y tienes S/${Number(reseller.saldo).toFixed(2)}`);
            }

            // 4. Deduct Balance
            await tx.reseller.update({
                where: { id: resellerId },
                data: { saldo: { decrement: costoFinal } }
            });

            await tx.resellerMovimiento.create({
                data: {
                    resellerId,
                    tipo: 'ACTIVACION',
                    monto: -costoFinal,
                    descripcion: `Activación cliente: ${data.razonSocial} - Plan: ${plan.nombre} (${descuento}% Off)`,
                }
            });

            const unidadMedida = await tx.unidadMedida.findFirst();
            if (!unidadMedida) {
                throw new BadRequestException('No hay unidades de medida disponibles en el sistema');
            }

            // 5. Create Empresa
            const empresa = await tx.empresa.create({
                data: {
                    ruc: data.rut, // RUC logic
                    razonSocial: data.razonSocial,
                    nombreComercial: data.razonSocial,
                    direccion: '-',
                    fechaActivacion: new Date(),
                    fechaExpiracion: new Date(new Date().setDate(new Date().getDate() + 30)), // 30 days
                    planId: plan.id,
                    resellerId: resellerId,
                    slugTienda: data.rut + Math.floor(Math.random() * 1000), // Temp slug
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
            const hashedPassword = await import('bcrypt').then(m => m.hash(data.password || '123456', 10));
            await tx.usuario.create({
                data: {
                    nombre: data.representa || 'Administrador',
                    email: data.email,
                    password: hashedPassword,
                    rol: 'ADMIN_EMPRESA',
                    empresaId: empresa.id,
                    dni: '-',
                    celular: data.celular || '-'
                }
            });

            return empresa;
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
                const costoFinal = this.calculatePlanCostWithDiscount(planCosto, descuento);
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
                            descripcion: `Renovación mensual cliente: ${empresa.razonSocial} - Plan: ${empresa.plan.nombre} (${descuento}% Off)`,
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
}
