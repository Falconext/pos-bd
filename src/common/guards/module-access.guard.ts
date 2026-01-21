import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { MODULE_KEY } from '../decorators/module.decorator';

@Injectable()
export class ModuleAccessGuard implements CanActivate {
    constructor(private reflector: Reflector, private prisma: PrismaService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredModule = this.reflector.getAllAndOverride<string>(MODULE_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredModule) {
            return true;
        }

        const { user } = context.switchToHttp().getRequest();

        if (!user) {
            return false;
        }

        if (user.rol === 'ADMIN_SISTEMA') {
            return true;
        }

        // 1. Get Plan Modules
        let planModulos: string[] = [];

        // Check if data is already available in user object
        if (user.empresa?.plan?.modulosAsignados) {
            planModulos = user.empresa.plan.modulosAsignados.map((m: any) => m.modulo.codigo);
        } else if (user.empresaId) {
            // Fetch from DB if missing
            const empresa = await this.prisma.empresa.findUnique({
                where: { id: user.empresaId },
                include: {
                    plan: {
                        include: {
                            modulosAsignados: {
                                include: { modulo: true }
                            }
                        }
                    }
                }
            });

            if (empresa?.plan?.modulosAsignados) {
                planModulos = empresa.plan.modulosAsignados.map(m => m.modulo.codigo);
            }
        }

        // 2. Validate Access
        if (!planModulos.includes(requiredModule)) {
            throw new ForbiddenException(`Su plan no incluye acceso al módulo: ${requiredModule}`);
        }

        return true;
    }
}
