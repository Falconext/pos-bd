import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  leerExcelReprecio,
  respaldoReprecio,
  tramosAPrecios,
  type FilaExcel,
  type TipoReprecioExcel,
} from './reprecio-excel';

type Mayorista = { cantidadMinima: number; precio: number }[];

export type EstadoFila = 'CAMBIA' | 'SIN_CAMBIO' | 'ERROR';

export interface FilaReprecioExcel {
  fila: number;
  codigo: string;
  estado: EstadoFila;
  mensaje?: string;
  productoId?: number;
  descripcion?: string;
  precioActual?: number;
  precioNuevo?: number | null;
  mayoristaActual?: Mayorista;
  mayoristaNuevo?: Mayorista | null;
  /** La sede tiene su propio precio: el cambio del precio normal no se verá ahí. */
  sedesConPrecioPropio?: number;
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (n: number) => Math.round(n * 10000) / 10000;

const mayoristaDe = (v: unknown): Mayorista =>
  (Array.isArray(v) ? v : [])
    .map((x: any) => ({ cantidadMinima: num(x?.cantidadMinima), precio: num(x?.precio) }))
    .filter((x) => x.cantidadMinima > 0 && x.precio > 0)
    .sort((a, b) => a.cantidadMinima - b.cantidadMinima);

const mismoMayorista = (a: Mayorista, b: Mayorista) =>
  a.length === b.length && a.every((x, i) => x.cantidadMinima === b[i].cantidadMinima && r2(x.precio) === r2(b[i].precio));

/** Afectación IGV (Catálogo 07): 10-17 gravado. */
const esGravado = (tipo: string | null | undefined) => String(tipo ?? '10').trim().startsWith('1');

/**
 * Reprecio del Kardex con Excel: previsualizar y aplicar comparten el mismo
 * cálculo (se vuelve a leer el archivo al aplicar), así lo que el empresario vio
 * es lo que se guarda.
 */
@Injectable()
export class ReprecioExcelService {
  constructor(private readonly prisma: PrismaService) {}

  private leer(buffer: Buffer) {
    try {
      return leerExcelReprecio(buffer);
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'No se pudo leer el Excel');
    }
  }

  async previsualizar(empresaId: number, buffer: Buffer) {
    const lectura = this.leer(buffer);
    const filas = await this.calcular(empresaId, lectura.tipo, lectura.filas);
    return {
      tipo: lectura.tipo,
      filas,
      resumen: {
        total: filas.length,
        cambian: filas.filter((f) => f.estado === 'CAMBIA').length,
        sinCambio: filas.filter((f) => f.estado === 'SIN_CAMBIO').length,
        errores: filas.filter((f) => f.estado === 'ERROR').length,
      },
    };
  }

  async aplicar(empresaId: number, buffer: Buffer) {
    const lectura = this.leer(buffer);
    const filas = await this.calcular(empresaId, lectura.tipo, lectura.filas);
    const cambian = filas.filter((f) => f.estado === 'CAMBIA' && f.productoId);
    if (cambian.length === 0) {
      throw new BadRequestException('No hay precios para cambiar en el archivo');
    }

    const productos = await this.prisma.producto.findMany({
      where: { empresaId, id: { in: cambian.map((f) => f.productoId!) } },
      select: { id: true, codigo: true, precioUnitario: true, preciosMayorista: true, igvPorcentaje: true, tipoAfectacionIGV: true },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));

    // El respaldo se arma con lo que había ANTES de escribir.
    const respaldo = respaldoReprecio(
      lectura.tipo,
      cambian.map((f) => {
        const p = porId.get(f.productoId!)!;
        return { codigo: p.codigo, precio: num(p.precioUnitario), mayorista: mayoristaDe(p.preciosMayorista) };
      }),
    );

    await this.prisma.$transaction(
      cambian.map((f) => {
        const p = porId.get(f.productoId!)!;
        const data: any = {};
        if (f.precioNuevo != null) {
          const igv = num(p.igvPorcentaje) || 18;
          data.precioUnitario = f.precioNuevo;
          data.valorUnitario = esGravado(p.tipoAfectacionIGV) ? +(f.precioNuevo / (1 + igv / 100)).toFixed(6) : f.precioNuevo;
        }
        if (f.mayoristaNuevo != null) data.preciosMayorista = f.mayoristaNuevo;
        return this.prisma.producto.update({ where: { id: p.id }, data });
      }),
    );

    return {
      tipo: lectura.tipo,
      actualizados: cambian.length,
      errores: filas.filter((f) => f.estado === 'ERROR').length,
      respaldoBase64: respaldo.toString('base64'),
    };
  }

  private async calcular(empresaId: number, tipo: TipoReprecioExcel, filas: FilaExcel[]): Promise<FilaReprecioExcel[]> {
    const codigos = [...new Set(filas.map((f) => f.codigo).filter(Boolean))];
    const candidatos = codigos.length
      ? await this.prisma.producto.findMany({
          where: {
            empresaId,
            estado: { not: 'PLACEHOLDER' as any },
            OR: [
              { codigo: { in: codigos, mode: 'insensitive' } },
              { codigoBarras: { in: codigos } },
            ],
          },
          select: {
            id: true,
            codigo: true,
            codigoBarras: true,
            descripcion: true,
            precioUnitario: true,
            preciosMayorista: true,
            stocks: { where: { precioUnitarioOverride: { not: null } }, select: { sedeId: true } },
          },
        })
      : [];
    const porCodigo = new Map<string, typeof candidatos>();
    const agregar = (k: string | null | undefined, p: (typeof candidatos)[number]) => {
      if (!k) return;
      const key = k.trim().toLowerCase();
      porCodigo.set(key, [...(porCodigo.get(key) || []), p]);
    };
    candidatos.forEach((p) => agregar(p.codigo, p));
    // El código de barras solo se usa si no hay un SKU igual.
    const porBarras = new Map<string, typeof candidatos>();
    candidatos.forEach((p) => {
      if (!p.codigoBarras) return;
      const key = p.codigoBarras.trim().toLowerCase();
      porBarras.set(key, [...(porBarras.get(key) || []), p]);
    });

    // Un código repetido en el archivo: manda la última fila.
    const ultimaFila = new Map<string, number>();
    filas.forEach((f) => f.codigo && ultimaFila.set(f.codigo.toLowerCase(), f.fila));

    return filas.map((f): FilaReprecioExcel => {
      const base = { fila: f.fila, codigo: f.codigo };
      if (!f.codigo) return { ...base, estado: 'ERROR', mensaje: 'Falta el código' };
      const key = f.codigo.toLowerCase();
      if (ultimaFila.get(key) !== f.fila) {
        return { ...base, estado: 'ERROR', mensaje: `Código repetido: se usa la fila ${ultimaFila.get(key)}` };
      }
      const encontrados = porCodigo.get(key) ?? porBarras.get(key) ?? [];
      const unicos = [...new Map(encontrados.map((p) => [p.id, p])).values()];
      if (unicos.length === 0) return { ...base, estado: 'ERROR', mensaje: 'No hay un producto con ese código' };
      if (unicos.length > 1) {
        return { ...base, estado: 'ERROR', mensaje: `El código coincide con ${unicos.length} productos; usa el código propio de cada uno` };
      }
      const p = unicos[0];
      const precioActual = num(p.precioUnitario);
      const mayoristaActual = mayoristaDe(p.preciosMayorista);
      const comun = {
        ...base,
        productoId: p.id,
        descripcion: p.descripcion,
        precioActual,
        mayoristaActual,
        ...(p.stocks.length ? { sedesConPrecioPropio: p.stocks.length } : {}),
      };

      if (tipo === 'PRECIO') {
        if (f.precio == null || f.precio <= 0) {
          return { ...comun, estado: 'ERROR', mensaje: f.precioInvalido ? `Precio no válido: "${f.precioInvalido}"` : 'Falta el precio o no es mayor que 0' };
        }
        const precioNuevo = r2(f.precio);
        return {
          ...comun,
          precioNuevo,
          mayoristaNuevo: null,
          estado: precioNuevo === r2(precioActual) ? 'SIN_CAMBIO' : 'CAMBIA',
        };
      }

      if (f.errorTramos) return { ...comun, estado: 'ERROR', mensaje: f.errorTramos };
      if (!f.tramos?.length) return { ...comun, estado: 'ERROR', mensaje: 'La fila no tiene rangos ni precios' };
      const { precioBase, mayorista } = tramosAPrecios(f.tramos);
      const precioNuevo = precioBase != null ? r2(precioBase) : null;
      const cambiaBase = precioNuevo != null && precioNuevo !== r2(precioActual);
      const cambiaMayorista = !mismoMayorista(mayorista, mayoristaActual);
      return {
        ...comun,
        precioNuevo,
        mayoristaNuevo: mayorista,
        estado: cambiaBase || cambiaMayorista ? 'CAMBIA' : 'SIN_CAMBIO',
      };
    });
  }
}
