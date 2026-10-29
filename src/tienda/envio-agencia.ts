/**
 * Envío por agencia (Shalom / Olva) desde la tienda virtual.
 *
 * Pedido de un cliente (29-10): en su web anterior el comprador elegía la
 * agencia de Shalom u Olva donde quería recoger, y con eso el negocio armaba
 * el envío. En nuestras tiendas solo había "envío a domicilio" con una
 * dirección libre, y al convertir el pedido el empresario tenía que volver a
 * preguntar la agencia y el DNI por WhatsApp.
 *
 * Ahora la tienda ofrece las agencias que el negocio encendió en su
 * configuración de envío, el comprador elige una y deja su DNI (Shalom y
 * Olva lo piden para entregar), y el pedido llega con todo eso. Al pasarlo a
 * nota de venta, el envío ya sale armado.
 */
import { BadRequestException } from '@nestjs/common';

export const COURIERS_TIENDA = ['SHALOM', 'OLVA'] as const;
export type CourierTienda = (typeof COURIERS_TIENDA)[number];

export const NOMBRE_COURIER: Record<CourierTienda, string> = {
  SHALOM: 'Shalom',
  OLVA: 'Olva Courier',
};

/** Lo que guarda la configuración de envío, saneado y sin repetidos. */
export function couriersValidos(raw: unknown): CourierTienda[] {
  if (!Array.isArray(raw)) return [];
  return COURIERS_TIENDA.filter((c) => raw.includes(c));
}

export function esCourierTienda(v: unknown): v is CourierTienda {
  return (COURIERS_TIENDA as readonly string[]).includes(String(v));
}

/** Una agencia como la ve el comprador: lo justo para elegir. */
export interface AgenciaTienda {
  id: string;
  nombre: string;
  departamento: string;
  provincia: string;
  distrito: string;
  direccion?: string;
}

export function agenciasShalom(
  data: { terId: string; nombre: string; departamento: string; provincia: string; distrito: string; estado?: string; direccion?: string }[],
): AgenciaTienda[] {
  return data
    // Las agencias cerradas no se ofrecen: el paquete no tendría dónde llegar.
    .filter((a) => a.terId && a.nombre && !/inactiv|cerrad/i.test(a.estado ?? ''))
    .map((a) => ({
      id: a.terId,
      nombre: a.nombre,
      departamento: a.departamento,
      provincia: a.provincia,
      distrito: a.distrito,
      ...(a.direccion ? { direccion: a.direccion } : {}),
    }))
    .sort(porLugar);
}

export function agenciasOlva(
  data: { codigo: string; nombre: string; departamento: string; provincia: string; distrito: string; direccion?: string }[],
): AgenciaTienda[] {
  return data
    .filter((a) => a.codigo && a.nombre)
    .map((a) => ({
      id: a.codigo,
      nombre: a.nombre,
      departamento: a.departamento,
      provincia: a.provincia,
      distrito: a.distrito,
      ...(a.direccion ? { direccion: a.direccion } : {}),
    }))
    .sort(porLugar);
}

function porLugar(a: AgenciaTienda, b: AgenciaTienda): number {
  return (
    a.departamento.localeCompare(b.departamento, 'es') ||
    a.provincia.localeCompare(b.provincia, 'es') ||
    a.nombre.localeCompare(b.nombre, 'es')
  );
}

/** Lo que manda el checkout cuando el comprador eligió agencia. */
export interface EnvioAgenciaPedido {
  envioCourier?: string;
  envioAgenciaId?: string;
  envioAgenciaNombre?: string;
  clienteDocumento?: string;
}

/**
 * Valida el envío por agencia de un pedido y devuelve lo que se guarda, o
 * null si el comprador no eligió agencia (envío a domicilio o recojo).
 */
export function envioAgenciaDelPedido(
  dto: EnvioAgenciaPedido & { tipoEntrega?: string },
  habilitados: CourierTienda[],
): {
  envioCourier: CourierTienda;
  envioAgenciaId: string | null;
  envioAgenciaNombre: string;
  clienteDocumento: string;
  agenciaEnvio: string;
} | null {
  const courier = dto.envioCourier?.trim().toUpperCase();
  if (!courier) return null;
  if (dto.tipoEntrega !== 'ENVIO') {
    throw new BadRequestException('La agencia solo se elige para pedidos con envío.');
  }
  if (!esCourierTienda(courier) || !habilitados.includes(courier)) {
    throw new BadRequestException('Esta tienda no envía por esa agencia.');
  }
  const nombre = dto.envioAgenciaNombre?.trim().slice(0, 200);
  if (!nombre) throw new BadRequestException('Elige la agencia donde recogerás tu pedido.');
  // DNI (8), carné de extranjería (9) o RUC (11): la agencia lo pide al entregar.
  const documento = (dto.clienteDocumento ?? '').replace(/\D/g, '');
  if (![8, 9, 11].includes(documento.length)) {
    throw new BadRequestException('Ingresa tu DNI: la agencia lo pide para entregarte el paquete.');
  }
  return {
    envioCourier: courier,
    envioAgenciaId: dto.envioAgenciaId?.trim().slice(0, 40) || null,
    envioAgenciaNombre: nombre,
    clienteDocumento: documento,
    // El campo de siempre, para las pantallas que ya lo muestran.
    agenciaEnvio: `${NOMBRE_COURIER[courier]} - ${nombre}`,
  };
}
