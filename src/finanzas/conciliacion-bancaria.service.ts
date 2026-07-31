import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Conciliación bancaria: importa un Excel del banco (movimientos con N° de
 * operación) y lo cruza contra los pagos de VENTAS (Pago.referencia) y de
 * COMPRAS (PagoCompra.referencia) del sistema mediante el número de operación.
 *
 * No persiste nada: es un proceso de solo lectura que devuelve el resultado
 * del cruce (conciliados, pendientes de banco, pendientes de sistema).
 */

export type OrigenPago = 'VENTA' | 'COMPRA';
export type EstadoConciliacion = 'CONCILIADO' | 'PENDIENTE';

export interface PagoSistema {
  origen: OrigenPago;
  operacion: string; // referencia original
  operacionNorm: string;
  documento: string; // serie-numero
  contraparte: string; // cliente / proveedor
  medioPago: string;
  monto: number;
  fecha: string; // YYYY-MM-DD
}

export interface MovimientoBanco {
  fila: number;
  fecha: string | null;
  operacion: string;
  descripcion: string;
  monto: number;
  tipo: 'ABONO' | 'CARGO' | null;
  estado: EstadoConciliacion;
  match: {
    origen: OrigenPago;
    documento: string;
    contraparte: string;
    monto: number;
    fecha: string;
    diferenciaMonto: number;
  } | null;
}

export interface ResultadoConciliacion {
  resumen: {
    movimientosBanco: number;
    pagosSistema: number;
    conciliados: number;
    pendientesBanco: number;
    pendientesSistema: number;
    montoBanco: number;
    montoConciliado: number;
    montoPendienteBanco: number;
    diferenciasMonto: number; // movimientos conciliados cuyo monto no cuadra
  };
  movimientos: MovimientoBanco[];
  sistemaPendientes: PagoSistema[];
}

const TOLERANCIA_MONTO = 0.01;

@Injectable()
export class ConciliacionBancariaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Normaliza el número de operación para comparar (sin espacios, guiones ni ceros a la izquierda). */
  private normOp(valor: unknown): string {
    return String(valor ?? '')
      .trim()
      .toUpperCase()
      .replace(/[\s\-.]/g, '')
      .replace(/^0+/, '');
  }

  /** Parsea un monto que puede venir como número o texto ("1,234.56" / "1.234,56"). */
  private parseMonto(valor: unknown): number {
    if (valor == null || valor === '') return 0;
    if (typeof valor === 'number') return Math.abs(valor);
    let s = String(valor).trim().replace(/[^0-9.,-]/g, '');
    // Si tiene ambos separadores, el último es el decimal.
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? Math.abs(n) : 0;
  }

  /** Intenta parsear una fecha en formatos comunes (dd/mm/yyyy, ISO, serial Excel). */
  private parseFecha(valor: unknown): string | null {
    if (valor == null || valor === '') return null;
    if (typeof valor === 'number') {
      // Serial de Excel (días desde 1899-12-30)
      const d = new Date(Math.round((valor - 25569) * 86400 * 1000));
      return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    }
    const s = String(valor).trim();
    // dd/mm/yyyy o dd-mm-yyyy
    const m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
    if (m) {
      let [, dd, mm, yyyy] = m;
      if (yyyy.length === 2) yyyy = `20${yyyy}`;
      const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      const d = new Date(`${iso}T12:00:00`);
      return Number.isNaN(d.getTime()) ? null : iso;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  }

  private pick(fila: Record<string, any>, claves: string[]): any {
    for (const c of claves) {
      if (fila[c] != null && fila[c] !== '') return fila[c];
    }
    return null;
  }

  /** Lee la primera hoja del archivo base64 normalizando encabezados. */
  private leerFilas(archivoBase64: string): Record<string, any>[] {
    try {
      const base64 = archivoBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
        defval: null,
        raw: false,
      });
      return filas.map((f) => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(f)) {
          const key = k
            .toString()
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, '');
          out[key] = typeof v === 'string' ? v.trim() : v;
        }
        return out;
      });
    } catch {
      throw new BadRequestException(
        'No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) o CSV válido.',
      );
    }
  }

  /** Carga los pagos del sistema (ventas + compras) con N° de operación. */
  private async cargarPagosSistema(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
  ): Promise<PagoSistema[]> {
    const rango =
      fechaInicio && fechaFin
        ? {
            gte: new Date(`${fechaInicio}T00:00:00.000-05:00`),
            lte: new Date(`${fechaFin}T23:59:59.999-05:00`),
          }
        : undefined;

    const [pagosVenta, pagosCompra] = await Promise.all([
      this.prisma.pago.findMany({
        where: {
          empresaId,
          referencia: { not: null },
          ...(rango ? { fecha: rango } : {}),
        },
        select: {
          fecha: true,
          monto: true,
          medioPago: true,
          referencia: true,
          comprobante: {
            select: {
              serie: true,
              correlativo: true,
              tipoDoc: true,
              cliente: { select: { nombre: true } },
            },
          },
        },
      }),
      this.prisma.pagoCompra.findMany({
        where: {
          empresaId,
          referencia: { not: null },
          ...(rango ? { fecha: rango } : {}),
        },
        select: {
          fecha: true,
          monto: true,
          metodoPago: true,
          referencia: true,
          compra: {
            select: {
              serie: true,
              numero: true,
              tipoDoc: true,
              proveedor: { select: { nombre: true } },
            },
          },
        },
      }),
    ]);

    const ventas: PagoSistema[] = pagosVenta
      .filter((p) => this.normOp(p.referencia).length > 0)
      .map((p) => ({
        origen: 'VENTA' as const,
        operacion: String(p.referencia ?? ''),
        operacionNorm: this.normOp(p.referencia),
        documento: p.comprobante
          ? `${p.comprobante.serie}-${p.comprobante.correlativo}`
          : '—',
        contraparte: p.comprobante?.cliente?.nombre || '—',
        medioPago: String(p.medioPago || '—'),
        monto: Number(p.monto || 0),
        fecha: p.fecha.toISOString().split('T')[0],
      }));

    const compras: PagoSistema[] = pagosCompra
      .filter((p) => this.normOp(p.referencia).length > 0)
      .map((p) => ({
        origen: 'COMPRA' as const,
        operacion: String(p.referencia ?? ''),
        operacionNorm: this.normOp(p.referencia),
        documento: p.compra
          ? `${p.compra.serie}-${p.compra.numero}`
          : '—',
        contraparte: p.compra?.proveedor?.nombre || '—',
        medioPago: String(p.metodoPago || '—'),
        monto: Number(p.monto || 0),
        fecha: p.fecha.toISOString().split('T')[0],
      }));

    return [...ventas, ...compras];
  }

  async conciliar(
    empresaId: number,
    archivoBase64: string,
    fechaInicio?: string,
    fechaFin?: string,
  ): Promise<ResultadoConciliacion> {
    const filas = this.leerFilas(archivoBase64);

    // 1. Parsear movimientos del banco
    const movimientos: MovimientoBanco[] = [];
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i];
      const operacionRaw = this.pick(f, [
        'nrooperacion',
        'numerooperacion',
        'numoperacion',
        'operacion',
        'noperacion',
        'noperacion',
        'operation',
        'referencia',
      ]);
      const operacion = String(operacionRaw ?? '').trim();
      // Se omiten filas sin número de operación (no conciliables).
      if (this.normOp(operacion).length === 0) continue;

      const tipoRaw = String(
        this.pick(f, ['tipo', 'tipomovimiento', 'cargoabono', 'movimiento']) ??
          '',
      ).toUpperCase();
      let tipo: 'ABONO' | 'CARGO' | null = null;
      if (/(ABONO|INGRESO|CREDITO|CRÉDITO|HABER|DEPOSITO|DEPÓSITO)/.test(tipoRaw))
        tipo = 'ABONO';
      else if (/(CARGO|EGRESO|DEBITO|DÉBITO|DEBE|RETIRO|PAGO)/.test(tipoRaw))
        tipo = 'CARGO';

      movimientos.push({
        fila: i + 2,
        fecha: this.parseFecha(
          this.pick(f, ['fecha', 'fechaoperacion', 'fechamovimiento', 'date']),
        ),
        operacion,
        descripcion: String(
          this.pick(f, [
            'descripcion',
            'glosa',
            'concepto',
            'detalle',
            'observacion',
          ]) ?? '',
        ),
        monto: this.parseMonto(
          this.pick(f, ['monto', 'importe', 'amount', 'valor']),
        ),
        tipo,
        estado: 'PENDIENTE',
        match: null,
      });
    }

    if (movimientos.length === 0) {
      throw new BadRequestException(
        'El archivo no contiene movimientos con número de operación. Revisa que exista la columna "NumeroOperacion".',
      );
    }

    // 2. Cargar pagos del sistema e indexarlos por N° de operación normalizado
    const pagosSistema = await this.cargarPagosSistema(
      empresaId,
      fechaInicio,
      fechaFin,
    );
    const indice = new Map<string, PagoSistema[]>();
    for (const p of pagosSistema) {
      const arr = indice.get(p.operacionNorm) ?? [];
      arr.push(p);
      indice.set(p.operacionNorm, arr);
    }

    // 3. Cruzar cada movimiento del banco contra el índice del sistema
    const usados = new Set<PagoSistema>();
    let diferenciasMonto = 0;
    let montoConciliado = 0;
    let montoBanco = 0;

    for (const mov of movimientos) {
      montoBanco += mov.monto;
      const candidatos = indice.get(this.normOp(mov.operacion)) ?? [];
      // Preferir un candidato del mismo signo (abono→venta, cargo→compra) y sin usar.
      const preferido: OrigenPago | null =
        mov.tipo === 'ABONO' ? 'VENTA' : mov.tipo === 'CARGO' ? 'COMPRA' : null;

      let elegido = candidatos.find(
        (c) => !usados.has(c) && (!preferido || c.origen === preferido),
      );
      if (!elegido) elegido = candidatos.find((c) => !usados.has(c));

      if (elegido) {
        usados.add(elegido);
        const dif = Number((mov.monto - elegido.monto).toFixed(2));
        if (Math.abs(dif) > TOLERANCIA_MONTO) diferenciasMonto++;
        montoConciliado += mov.monto;
        mov.estado = 'CONCILIADO';
        mov.match = {
          origen: elegido.origen,
          documento: elegido.documento,
          contraparte: elegido.contraparte,
          monto: elegido.monto,
          fecha: elegido.fecha,
          diferenciaMonto: dif,
        };
      }
    }

    // 4. Pagos del sistema que no aparecieron en el banco
    const sistemaPendientes = pagosSistema.filter((p) => !usados.has(p));

    const conciliados = movimientos.filter(
      (m) => m.estado === 'CONCILIADO',
    ).length;
    const pendientesBanco = movimientos.length - conciliados;
    const montoPendienteBanco = movimientos
      .filter((m) => m.estado === 'PENDIENTE')
      .reduce((s, m) => s + m.monto, 0);

    const r2 = (n: number) => Math.round(n * 100) / 100;

    return {
      resumen: {
        movimientosBanco: movimientos.length,
        pagosSistema: pagosSistema.length,
        conciliados,
        pendientesBanco,
        pendientesSistema: sistemaPendientes.length,
        montoBanco: r2(montoBanco),
        montoConciliado: r2(montoConciliado),
        montoPendienteBanco: r2(montoPendienteBanco),
        diferenciasMonto,
      },
      movimientos,
      sistemaPendientes,
    };
  }

  /** Genera la plantilla .xlsx (base64) con las columnas esperadas del banco. */
  plantilla(): { nombreArchivo: string; base64: string } {
    const ejemplo = [
      {
        Fecha: '15/07/2026',
        NumeroOperacion: '00012345',
        Monto: 150.5,
        Descripcion: 'Abono Yape - Venta B001-120',
        Tipo: 'ABONO',
      },
      {
        Fecha: '15/07/2026',
        NumeroOperacion: '00067890',
        Monto: 320.0,
        Descripcion: 'Pago proveedor - Compra F001-45',
        Tipo: 'CARGO',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(ejemplo);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'MovimientosBanco');
    const buffer: Buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    return {
      nombreArchivo: 'plantilla_conciliacion_bancaria.xlsx',
      base64: buffer.toString('base64'),
    };
  }
}
