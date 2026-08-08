import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Tabla Maestra de Productos (catálogo global, cache-through).
 *
 * Fuente de verdad compartida entre TODAS las empresas, indexada por código de
 * barras (EAN/UPC). Devuelve imagen + categoría + marca sugeridas. Se consulta
 * ANTES de llamar a la IA/Serper; cuando la IA resuelve algo nuevo, se guarda
 * aquí (se autopobla). Evita pagar/repetir búsquedas para el mismo producto.
 */
@Injectable()
export class ProductoMaestroService {
  constructor(private prisma: PrismaService) {}

  private norm(s?: string | null): string {
    return String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
  private normCodigo(c?: string | null): string {
    return String(c || '').replace(/\s+/g, '').toUpperCase();
  }

  private registrarUso(id: number): void {
    this.prisma.productoMaestro
      .update({ where: { id }, data: { vecesUsada: { increment: 1 }, ultimoUsoEn: new Date() } })
      .catch(() => {});
  }

  /** Lookup principal: por código de barras (global). */
  async buscarPorCodigoBarras(codigoBarras?: string | null) {
    const cb = this.normCodigo(codigoBarras);
    if (!cb) return null;
    const m = await this.prisma.productoMaestro.findUnique({ where: { codigoBarras: cb } });
    if (m) this.registrarUso(m.id);
    return m;
  }

  /** Fallback: por nombre normalizado (+ marca opcional). Menos confiable. */
  async buscarPorTexto(nombre?: string, marca?: string) {
    const nn = this.norm(nombre);
    if (!nn) return null;
    const m = await this.prisma.productoMaestro.findFirst({
      where: { nombreNorm: nn, ...(this.norm(marca) ? { marca: this.norm(marca) } : {}) },
      orderBy: { vecesUsada: 'desc' },
    });
    if (m) this.registrarUso(m.id);
    return m;
  }

  /** Lookup combinado (código de barras -> texto). */
  async buscar(params: { codigoBarras?: string; nombre?: string; marca?: string }) {
    return (
      (await this.buscarPorCodigoBarras(params.codigoBarras)) ||
      (await this.buscarPorTexto(params.nombre, params.marca))
    );
  }

  /** Cache-through: guarda/actualiza lo que resolvió la IA/Serper. Best-effort. */
  async upsert(data: {
    codigoBarras?: string;
    nombre: string;
    marca?: string;
    categoria?: string;
    imagenUrl?: string;
    descripcion?: string;
    fuente?: string;
    aprobada?: boolean;
  }) {
    const nombre = String(data.nombre || '').trim();
    if (!nombre) return null;
    const cb = this.normCodigo(data.codigoBarras);
    const nombreNorm = this.norm(nombre);
    const marca = this.norm(data.marca) || null;
    const categoria = String(data.categoria || '').trim() || null;
    const imagenUrl = data.imagenUrl || null;
    const base = {
      nombre,
      nombreNorm,
      marca,
      categoria,
      descripcion: data.descripcion || null,
      fuente: data.fuente || 'IA',
      aprobada: data.aprobada ?? false,
    };
    try {
      if (cb) {
        return await this.prisma.productoMaestro.upsert({
          where: { codigoBarras: cb },
          create: { codigoBarras: cb, imagenUrl, ...base },
          // Solo sobreescribe campos con valor (no borra datos curados con nulls).
          update: {
            nombre,
            nombreNorm,
            ...(imagenUrl ? { imagenUrl } : {}),
            ...(marca ? { marca } : {}),
            ...(categoria ? { categoria } : {}),
            fuente: base.fuente,
          },
        });
      }
      // Sin código de barras: no duplicar por nombre.
      const existing = await this.prisma.productoMaestro.findFirst({
        where: { nombreNorm, codigoBarras: null },
      });
      if (existing) {
        if (imagenUrl && !existing.imagenUrl) {
          return await this.prisma.productoMaestro.update({ where: { id: existing.id }, data: { imagenUrl } });
        }
        return existing;
      }
      return await this.prisma.productoMaestro.create({ data: { codigoBarras: null, imagenUrl, ...base } });
    } catch {
      return null;
    }
  }
}
