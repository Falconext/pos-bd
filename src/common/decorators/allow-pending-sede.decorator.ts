import { SetMetadata } from '@nestjs/common';

/**
 * Marca un endpoint como permitido para el token TEMPORAL de selección de sede
 * (el que trae `pendingSedeSelection: true`). El resto de endpoints rechaza ese
 * token: solo sirve para llamar a /auth/select-sede.
 */
export const ALLOW_PENDING_SEDE = 'allowPendingSede';
export const AllowPendingSede = () => SetMetadata(ALLOW_PENDING_SEDE, true);
