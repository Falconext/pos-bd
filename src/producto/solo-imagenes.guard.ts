import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Usuario delegado solo para las fotos de los productos
 * (`Usuario.soloImagenesProductos`).
 *
 * Puede leer el catálogo y subir, cambiar, ordenar o borrar fotos (principal,
 * extras, por color, galería, imagen con IA). Cualquier otra escritura sobre
 * productos —precio, stock, nombre, alta, baja, lotes, importación— se rechaza.
 *
 * Va en el controlador de productos, después de JwtAuthGuard: `JwtStrategy`
 * relee la bandera en cada request. ADMIN_EMPRESA nunca se restringe.
 */
const RUTAS_DE_IMAGEN = [
  /\/ia\/generar-imagen$/,
  /\/ia\/aprobar-imagen$/,
  /\/:id\/imagen$/,
  /\/:id\/imagen-extra$/,
  /\/:id\/imagen-url$/,
  /\/:id\/galeria$/,
  /\/:id\/imagenes-extra$/,
  /\/:id\/imagen-color$/,
  /\/:id\/imagen-color-url$/,
  /\/:id\/importar-imagen-url$/,
];

export function esRutaDeImagen(ruta: string): boolean {
  return RUTAS_DE_IMAGEN.some((r) => r.test(ruta));
}

@Injectable()
export class SoloImagenesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (user?.rol !== 'USUARIO_EMPRESA' || !user?.soloImagenesProductos) return true;
    if (req.method === 'GET') return true;
    if (esRutaDeImagen(String(req.route?.path ?? ''))) return true;
    throw new ForbiddenException(
      'Tu usuario solo puede gestionar las fotos de los productos. Pídele a tu administrador que te habilite el resto en Usuarios.',
    );
  }
}
