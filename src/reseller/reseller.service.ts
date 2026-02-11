import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Reseller, ResellerRecarga, ResellerMovimiento, EstadoType } from '@prisma/client'; // Import EstadoType

@Injectable()
export class ResellerService {
    constructor(private prisma: PrismaService) { }


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
        return this.prisma.reseller.update({
            where: { id },
            data
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
                empresas: true,
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
        // Bronce: 100-249 -> 20%
        // Plata: 250-499 -> 30%
        // Oro: 500+ -> 40%
        let nuevoDescuento = 0; // Base 0%
        if (monto >= 500) nuevoDescuento = 40.0;
        else if (monto >= 250) nuevoDescuento = 30.0;
        else if (monto >= 100) nuevoDescuento = 20.0;

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
        return this.prisma.$transaction(async (tx) => {
            // 1. Fetch Reseller & Check Balance (Locked for safety?)
            const reseller = await tx.reseller.findUnique({ where: { id: resellerId } });
            if (!reseller) throw new NotFoundException('Reseller no encontrado');

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
            // Safe cast as we know property exists
            const descuento = Number((reseller as any).porcentajeDescuento) || 0;
            const costoFinal = planCosto * (1 - descuento / 100);

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
                }
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
