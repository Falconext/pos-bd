import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { estadoPublico } from './estado-publico';
import {
  Liquidacion,
  esCobrable,
  liquidar,
  periodoAnterior,
  periodoDe,
  rangoDelPeriodo,
} from './tarifas';

/**
 * Cuánto consumió cada integrador y cuánto se le cobra.
 *
 * El diseño descansa en una distinción que vale la pena entender porque es la
 * que evita los dos errores caros:
 *
 *  - **El mes en curso se calcula en vivo** contra `Comprobante`. Así el
 *    número que ve el integrador es siempre la verdad, sin un contador
 *    paralelo que pueda desincronizarse —y un contador que se desincroniza no
 *    avisa: simplemente cobra mal.
 *
 *  - **El mes cerrado se congela** en `ConsumoApiMes`. Una vez emitida la
 *    factura no puede moverse, y se movería: un comprobante que SUNAT acepta
 *    tarde, o uno que se anula en el mes siguiente, cambiarían un total ya
 *    cobrado.
 *
 * Lo que une las dos mitades es la marca `apiPeriodoFacturado` en cada
 * comprobante. Hace tres cosas a la vez: cerrar dos veces no cobra dos veces,
 * un comprobante aceptado tarde cae en el próximo cierre en vez de perderse,
 * y el detalle por emisor se puede reconstruir desde los comprobantes sin
 * guardar una segunda copia que podría discrepar de lo cobrado.
 */
@Injectable()
export class MedidorApiService {
  /** El concepto con que viaja el consumo de la API a `CobroEmpresa`. */
  static readonly CONCEPTO = 'API_FACTURACION';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Los comprobantes de un integrador que entran en un período.
   *
   * El estado se evalúa en JavaScript y no en SQL porque `observed` depende
   * del código del CDR, que vive dentro de un texto JSON. Traerlos y filtrar
   * acá es más lento que un `WHERE`, pero usa exactamente la misma función que
   * decide el estado que ve el integrador: si el cobro y la consulta
   * discreparan, el integrador vería un comprobante en un estado y pagaría
   * por otro.
   */
  private async cobrablesDelPeriodo(integradorId: number, periodo: string) {
    const { desde, hasta } = rangoDelPeriodo(periodo);
    const filas = await this.prisma.comprobante.findMany({
      where: {
        apiPublicId: { not: null },
        empresa: { integradorId },
        fechaEmision: { gte: desde, lt: hasta },
      },
      select: {
        id: true,
        apiPublicId: true,
        tipoDoc: true,
        serie: true,
        correlativo: true,
        estadoEnvioSunat: true,
        sunatCdrResponse: true,
        apiPeriodoFacturado: true,
        empresaId: true,
        empresa: { select: { apiPublicId: true, razonSocial: true, ruc: true } },
      },
    });
    return filas.filter((c) => esCobrable(estadoPublico(c as any)));
  }

  /**
   * El consumo del período, con el detalle por emisor.
   *
   * Si el período ya se cerró devuelve lo congelado, no un recálculo: es lo
   * que dice la factura que el integrador tiene en la mano.
   */
  async consumo(integradorId: number, periodo?: string) {
    const p = periodo ?? periodoDe(new Date());
    const cerrado = await this.prisma.consumoApiMes.findUnique({
      where: { integradorId_periodo: { integradorId, periodo: p } },
    });

    const cobrables = await this.cobrablesDelPeriodo(integradorId, p);
    const porEmisor = new Map<string, { issuer_id: string; name: string; ruc: string; count: number }>();
    for (const c of cobrables as any[]) {
      const k = c.empresa?.apiPublicId ?? String(c.empresaId);
      const e = porEmisor.get(k) ?? {
        issuer_id: k,
        name: c.empresa?.razonSocial ?? '',
        ruc: c.empresa?.ruc ?? '',
        count: 0,
      };
      e.count++;
      porEmisor.set(k, e);
    }

    const emisores = [...porEmisor.values()];
    const vivo = liquidar(emisores.map((e) => e.count));
    const l: Liquidacion = cerrado
      ? {
          cantidad: cerrado.cantidad,
          precioUnitario: cerrado.precioUnitario,
          porEmisor: vivo.porEmisor,
          subtotalConsumo: cerrado.subtotal - 0,
          ajusteMinimo: 0,
          subtotal: cerrado.subtotal,
          igv: cerrado.igv,
          total: cerrado.total,
          aplicoMinimo: cerrado.aplicoMinimo,
        }
      : vivo;

    return {
      object: 'usage',
      period: p,
      status: cerrado ? 'closed' : 'open',
      closed_at: cerrado?.cerradoEn?.toISOString(),
      billable_count: l.cantidad,
      unit_price: l.precioUnitario,
      subtotal: l.subtotal,
      tax: l.igv,
      total: l.total,
      minimum_applied: l.aplicoMinimo,
      currency: 'PEN',
      // Lo que paga cada empresa (sin IGV): hasta 20 a S/ 0.05, de 21 a 100
      // S/ 5 fijo, más de 100 S/ 5 + S/ 0.05 por cada uno extra.
      by_issuer: emisores
        .map((e, i) => ({ ...e, charge: vivo.porEmisor[i] }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /**
   * Cierra un período para un integrador y deja el total congelado.
   *
   * Es idempotente por dos vías independientes, y las dos hacen falta: el
   * `findUnique` evita el trabajo, y el índice único de la base evita el cobro
   * duplicado si dos procesos cierran a la vez. Confiar solo en la lectura
   * previa sería suficiente hasta el día que haya dos instancias.
   */
  async cerrarPeriodo(integradorId: number, periodo: string) {
    const ya = await this.prisma.consumoApiMes.findUnique({
      where: { integradorId_periodo: { integradorId, periodo } },
    });
    if (ya) return { periodo, yaEstaba: true, cantidad: ya.cantidad, total: ya.total };

    const cobrables = await this.cobrablesDelPeriodo(integradorId, periodo);
    // Solo los que nadie cobró todavía. Un comprobante que SUNAT aceptó
    // después del cierre anterior cae acá, en el período que le toca ahora.
    const sinCobrar = cobrables.filter((c) => !c.apiPeriodoFacturado);
    // La tarifa es por empresa: se cuenta cuántos tiene cada una.
    const porEmpresa = new Map<number, number>();
    for (const c of sinCobrar) porEmpresa.set(c.empresaId, (porEmpresa.get(c.empresaId) ?? 0) + 1);
    const l = liquidar([...porEmpresa.values()]);

    try {
      await this.prisma.$transaction([
        this.prisma.consumoApiMes.create({
          data: {
            integradorId,
            periodo,
            cantidad: l.cantidad,
            precioUnitario: l.precioUnitario,
            subtotal: l.subtotal,
            igv: l.igv,
            total: l.total,
            aplicoMinimo: l.aplicoMinimo,
          },
        }),
        this.prisma.comprobante.updateMany({
          where: { id: { in: sinCobrar.map((c) => c.id) } },
          data: { apiPeriodoFacturado: periodo },
        }),
      ]);
    } catch (e: any) {
      // P2002: otro proceso lo cerró primero. No es un error que deba
      // propagarse; lo cobrado es lo que quedó, no lo que íbamos a escribir.
      if (e?.code === 'P2002') {
        const otro = await this.prisma.consumoApiMes.findUnique({
          where: { integradorId_periodo: { integradorId, periodo } },
        });
        return { periodo, yaEstaba: true, cantidad: otro?.cantidad ?? 0, total: otro?.total ?? 0 };
      }
      throw e;
    }
    return { periodo, yaEstaba: false, cantidad: l.cantidad, total: l.total };
  }

  /**
   * Cierra el mes anterior para todos los integradores.
   *
   * Corre el día 2 y no el 1 a propósito: un comprobante emitido el último día
   * del mes a las 23:50 puede estar todavía esperando el CDR cuando cambia la
   * fecha. Cerrando el día 1 quedaría sin cobrar hasta el mes siguiente, y el
   * integrador vería un corrimiento raro en su factura. Un día de gracia
   * alcanza: el scheduler de SUNAT reintenta cada pocos minutos.
   */
  @Cron('0 5 2 * *')
  async cerrarMesAnterior() {
    const periodo = periodoAnterior(new Date());
    const integradores = await this.prisma.empresa.findMany({
      where: { emisores: { some: {} } },
      select: { id: true, razonSocial: true },
    });

    const resultados: Array<{ integradorId: number; periodo: string; cantidad: number; total: number }> = [];
    for (const i of integradores) {
      try {
        const r = await this.cerrarPeriodo(i.id, periodo);
        // Cerrar y facturar van juntos, pero el cobro no puede tumbar el
        // cierre: si falla, el período queda cerrado igual y la factura se
        // puede volver a pedir. Al revés —cerrar sin poder reabrir— sería
        // perder el consumo del mes.
        try {
          await this.facturarConsumo(i.id, periodo);
        } catch (ef: any) {
          console.error(`[api-facturacion] cerrado ${periodo} de ${i.razonSocial} pero no se pudo emitir el cobro:`, ef?.message);
        }
        resultados.push({ integradorId: i.id, ...r });
      } catch (e: any) {
        // Que falle uno no puede dejar sin cerrar a los demás.
        console.error(`[api-facturacion] no se pudo cerrar ${periodo} de ${i.razonSocial}:`, e?.message);
      }
    }
    if (resultados.length) {
      console.log(`[api-facturacion] cerrado ${periodo}: ${resultados.length} integradores`);
    }
    return resultados;
  }

  /**
   * Convierte el consumo cerrado en un cobro al integrador.
   *
   * No inventa un circuito de cobranza nuevo: escribe en `CobroEmpresa`, que
   * es por donde ya pasan la cobranza, el asiento contable (`IngresoSistema`)
   * y la pantalla del panel. Un segundo circuito significaría dos lugares
   * donde mirar cuánto debe un cliente, y tarde o temprano discrepan.
   *
   * Es idempotente por el índice único `[empresaId, periodo, concepto]`. El
   * concepto hace falta: un integrador puede pagar su propia mensualidad del
   * ERP y su consumo de API el mismo mes, y sin distinguirlos el segundo
   * cobro chocaría contra el primero y se perdería sin ruido.
   */
  async facturarConsumo(integradorId: number, periodo: string) {
    const consumo = await this.prisma.consumoApiMes.findUnique({
      where: { integradorId_periodo: { integradorId, periodo } },
    });
    if (!consumo) {
      throw new Error(
        `No se puede facturar ${periodo} del integrador ${integradorId}: el período no está cerrado.`,
      );
    }

    const ya = await this.prisma.cobroEmpresa.findFirst({
      where: { empresaId: integradorId, periodo, concepto: MedidorApiService.CONCEPTO },
      select: { id: true, monto: true },
    });
    if (ya) return { cobroId: ya.id, yaEstaba: true, total: Number(ya.monto) };

    // Sin mínimo mensual: un mes sin comprobantes no genera cobro.
    if (!consumo.total) return { cobroId: 0, yaEstaba: false, total: 0 };

    // Vence a 15 días del cierre, como cualquier factura a crédito.
    const vence = new Date();
    vence.setDate(vence.getDate() + 15);

    const detalle =
      `${consumo.cantidad.toLocaleString('es-PE')} comprobantes aceptados`;

    try {
      const cobro = await this.prisma.cobroEmpresa.create({
        data: {
          empresaId: integradorId,
          periodo,
          concepto: MedidorApiService.CONCEPTO,
          // El total lleva IGV: es lo que se le cobra al integrador.
          monto: consumo.total,
          estado: 'PENDIENTE',
          fechaVencimiento: vence,
          descripcion: `API de facturación ${periodo} — ${detalle}`,
        },
        select: { id: true },
      });
      return { cobroId: cobro.id, yaEstaba: false, total: consumo.total };
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const otro = await this.prisma.cobroEmpresa.findFirst({
          where: { empresaId: integradorId, periodo, concepto: MedidorApiService.CONCEPTO },
          select: { id: true, monto: true },
        });
        return { cobroId: otro?.id ?? 0, yaEstaba: true, total: Number(otro?.monto ?? 0) };
      }
      throw e;
    }
  }
}
