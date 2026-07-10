import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Gestión de API keys de la API pública de Logística.
 *
 * Seguridad: solo se persiste el **hash SHA-256** de la clave, nunca el texto
 * plano. La clave completa se devuelve UNA sola vez al generarla; después solo
 * se puede identificar por `prefijo` + `ultimosCuatro`.
 */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /** Genera y persiste una API key. Devuelve la clave en claro UNA sola vez. */
  async generateKey(
    empresaId: number,
    opts?: { nombre?: string; entorno?: 'live' | 'test' },
  ) {
    const entorno = opts?.entorno === 'test' ? 'test' : 'live';
    const apiKey = `sk_${entorno}_${randomBytes(24).toString('base64url')}`;
    const registro = await this.prisma.apiKeyLogistica.create({
      data: {
        empresaId,
        nombre: opts?.nombre ?? null,
        entorno,
        prefijo: apiKey.slice(0, 12),
        ultimosCuatro: apiKey.slice(-4),
        hash: this.hash(apiKey),
      },
    });
    return {
      id: registro.id,
      apiKey, // ← solo visible aquí; no se puede recuperar después
      nombre: registro.nombre,
      entorno: registro.entorno,
      prefijo: registro.prefijo,
      ultimosCuatro: registro.ultimosCuatro,
      creadoEn: registro.creadoEn,
    };
  }

  /** Valida una API key en claro. Devuelve el registro (con empresaId) o null. */
  async validateKey(apiKey: string) {
    if (!apiKey) return null;
    const registro = await this.prisma.apiKeyLogistica.findUnique({
      where: { hash: this.hash(apiKey) },
    });
    if (!registro || !registro.activo || registro.revocadaEn) return null;
    // Marca de último uso (best-effort, no bloquea la petición).
    void this.prisma.apiKeyLogistica
      .update({ where: { id: registro.id }, data: { ultimoUsoEn: new Date() } })
      .catch(() => undefined);
    return registro;
  }

  /** Lista las keys activas de una empresa (sin exponer el hash). */
  async listKeys(empresaId: number) {
    return this.prisma.apiKeyLogistica.findMany({
      where: { empresaId, revocadaEn: null },
      select: {
        id: true,
        nombre: true,
        entorno: true,
        prefijo: true,
        ultimosCuatro: true,
        activo: true,
        ultimoUsoEn: true,
        creadoEn: true,
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  /** Revoca (soft) una key de la empresa. Devuelve null si no le pertenece. */
  async revokeKey(empresaId: number, id: number) {
    const key = await this.prisma.apiKeyLogistica.findFirst({
      where: { id, empresaId },
    });
    if (!key) return null;
    return this.prisma.apiKeyLogistica.update({
      where: { id },
      data: { activo: false, revocadaEn: new Date() },
      select: { id: true, activo: true, revocadaEn: true },
    });
  }
}
