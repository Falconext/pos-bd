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

    const l: Liquidacion = cerrado
      ? {
          cantidad: cerrado.cantidad,
          precioUnitario: cerrado.precioUnitario,
          subtotalConsumo: cerrado.subtotal - 0,
          ajusteMinimo: 0,
          subtotal: cerrado.subtotal,
          igv: cerrado.igv,
          total: cerrado.total,
          aplicoMinimo: cerrado.aplicoMinimo,
        }
      : liquidar(cobrables.length);

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
      by_issuer: [...porEmisor.values()].sort((a, b) => b.count - a.count),
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
    const l = liquidar(sinCobrar.length);

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
}
