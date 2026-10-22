import { BadRequestException } from '@nestjs/common';

/**
 * Los pagos con los que nace una compra.
 *
 * Hasta el 22-10 una compra al contado se pagaba con UN método. Quien le pagaba
 * a un proveedor S/ 300 de la caja y S/ 200 por Yape tenía que elegir uno, y el
 * cierre de caja descuadraba: o esperaba S/ 200 de menos o S/ 300 de más. Con
 * `pagosIniciales` cada parte se guarda con su método y solo la de efectivo
 * sale de la caja.
 *
 * Sin `pagosIniciales` todo queda como antes: un solo pago con
 * montoPagadoInicial / metodoPagoInicial.
 */

export interface PagoInicial {
  metodo: string;
  monto: number;
  cuentaBancariaId?: number;
  referencia?: string;
}

interface DatosPago {
  montoPagadoInicial?: number;
  metodoPagoInicial?: string;
  cuentaBancariaIdInicial?: number;
  referenciaInicial?: string;
  pagosIniciales?: Array<Partial<PagoInicial>>;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Margen para que S/ 0.01 de redondeo entre filas no rechace un pago exacto. */
const TOLERANCIA = 0.01;

export function pagosIniciales(
  data: DatosPago,
  total: number,
  esPendiente: boolean,
): PagoInicial[] {
  if (esPendiente) return [];

  if (Array.isArray(data.pagosIniciales) && data.pagosIniciales.length) {
    const pagos = data.pagosIniciales
      .map((p) => ({
        metodo: String(p.metodo || '').trim().toUpperCase() || 'EFECTIVO',
        monto: redondear(Math.max(0, Number(p.monto) || 0)),
        cuentaBancariaId: p.cuentaBancariaId || undefined,
        referencia: p.referencia?.trim() || undefined,
      }))
      .filter((p) => p.monto > 0);
    const suma = redondear(pagos.reduce((a, p) => a + p.monto, 0));
    // Acá no se recorta como en el pago único: si las partes suman más que la
    // factura, alguna está mal escrita y recortarla escondería cuál.
    if (suma > total + TOLERANCIA) {
      throw new BadRequestException(
        `Los pagos suman S/ ${suma.toFixed(2)} y la compra es de S/ ${total.toFixed(2)}.`,
      );
    }
    return pagos;
  }

  // El pago inicial nunca supera el total (un cliente que calculó el total
  // con IGV sobre exonerados mandaría de más).
  const monto = Math.min(
    total,
    Math.max(0, redondear(Number(data.montoPagadoInicial) || 0)),
  );
  if (!(monto > 0)) return [];
  return [
    {
      metodo: data.metodoPagoInicial || 'EFECTIVO',
      monto,
      cuentaBancariaId: data.cuentaBancariaIdInicial || undefined,
      referencia: data.referenciaInicial || undefined,
    },
  ];
}
