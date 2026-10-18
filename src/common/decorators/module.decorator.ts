import { SetMetadata } from '@nestjs/common';

export const MODULE_KEY = 'module';
/**
 * Módulo(s) del plan que habilitan la ruta. Varios códigos = basta con uno:
 * el mismo módulo puede llamarse distinto en el seed y en el frontend
 * (p. ej. `reportes` / `contabilidad`).
 */
export const RequiresModule = (...modules: string[]) =>
  SetMetadata(MODULE_KEY, modules);
