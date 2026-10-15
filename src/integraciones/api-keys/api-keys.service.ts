import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProductoApi } from './producto-api';

/**
 * API keys de las APIs públicas, de todos los productos.
 *
 * Nació en `logistica/integraciones` y se generalizó al abrir Facturación: la
 * mecánica es idéntica y duplicarla habría dejado dos sitios donde arreglar
 * el día que algo falle en la autenticación.
 *
 * Solo se persiste el SHA-256 de la clave, nunca el texto plano. La clave
 * completa se devuelve UNA vez al generarla; después solo se identifica por
 * `prefijo` + `ultimosCuatro`.
 */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /**
   * Genera y persiste una API key. Devuelve la clave en claro UNA sola vez.
   *
   * El prefijo es `sk_live_` / `sk_test_` para todos los productos: es lo que
   * el código ya emitía y lo que las guías del portal documentan, y cambiarlo
   * habría dejado las keys existentes con un formato distinto al de las
   * nuevas sin ganar nada.
   */
  async generateKey(
    empresaId: number,
    producto: ProductoApi,
    opts?: { nombre?: string; entorno?: 'live' | 'test' },
  ) {
    const entorno = opts?.entorno === 'test' ? 'test' : 'live';
    const apiKey = `sk_${entorno}_${randomBytes(24).toString('base64url')}`;
    const registro = await this.prisma.apiKey.create({
      data: {
        empresaId,
        producto,
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
      producto: registro.producto,
      nombre: registro.nombre,
      entorno: registro.entorno,
      prefijo: registro.prefijo,
      ultimosCuatro: registro.ultimosCuatro,
      creadoEn: registro.creadoEn,
    };
  }

  /**
   * Valida una API key en claro contra el producto que protege el endpoint.
   *
   * Devuelve el registro, o un motivo: `invalida` (no existe o está revocada)
   * y `producto` (es válida, pero de otra API) se distinguen porque merecen
   * respuestas distintas — 401 contra 403 — y porque confundirlas manda al
   * integrador a rotar una key que estaba bien.
   */
  async validarParaProducto(
    apiKey: string,
    producto: ProductoApi,
  ): Promise<
    | { ok: true; registro: { id: number; empresaId: number; entorno: string; producto: string } }
    | { ok: false; motivo: 'invalida' | 'producto' }
  > {
    if (!apiKey) return { ok: false, motivo: 'invalida' };
    const registro = await this.prisma.apiKey.findUnique({
      where: { hash: this.hash(apiKey) },
    });
    if (!registro || !registro.activo || registro.revocadaEn) {
      return { ok: false, motivo: 'invalida' };
    }
    if (registro.producto !== producto) return { ok: false, motivo: 'producto' };

    // Marca de último uso, best-effort: no bloquea ni tumba la petición.
    void this.prisma.apiKey
      .update({ where: { id: registro.id }, data: { ultimoUsoEn: new Date() } })
      .catch(() => undefined);
    return { ok: true, registro };
  }

  /** Lista las keys vigentes de una empresa para un producto, sin el hash. */
  async listKeys(empresaId: number, producto: ProductoApi) {
    return this.prisma.apiKey.findMany({
      where: { empresaId, producto, revocadaEn: null },
      select: {
        id: true,
        nombre: true,
        producto: true,
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

  /**
   * Revoca una key de la empresa. Devuelve null si no le pertenece.
   *
   * El `producto` entra en el filtro: sin él, la consola de un producto podría
   * revocar las keys del otro pasando un id ajeno.
   */
  async revokeKey(empresaId: number, producto: ProductoApi, id: number) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, empresaId, producto },
    });
    if (!key) return null;
    return this.prisma.apiKey.update({
      where: { id },
      data: { activo: false, revocadaEn: new Date() },
      select: { id: true, activo: true, revocadaEn: true },
    });
  }

  /** Comparación en tiempo constante, para lo que no pase por el hash. */
  static sonIguales(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
