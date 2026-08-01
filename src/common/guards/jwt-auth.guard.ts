import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { ALLOW_PENDING_SEDE } from '../decorators/allow-pending-sede.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;

    // El token temporal de selección de sede (pendingSedeSelection) SOLO puede
    // usarse en endpoints marcados con @AllowPendingSede (p. ej. select-sede).
    // En cualquier otro endpoint se rechaza: antes se aceptaba como token pleno.
    const req = context.switchToHttp().getRequest();
    if (req?.user?.pendingSedeSelection) {
      const permitido = this.reflector?.getAllAndOverride<boolean>(
        ALLOW_PENDING_SEDE,
        [context.getHandler(), context.getClass()],
      );
      if (!permitido) {
        throw new UnauthorizedException(
          'Debes seleccionar una sede antes de continuar.',
        );
      }
    }
    return true;
  }
}
