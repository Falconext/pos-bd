import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsInt,
  IsNumber,
  Min,
  IsIn,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum EstadoDespacho {
  PREPARANDO = 'PREPARANDO',
  EN_CAMINO = 'EN_CAMINO',
  EN_AGENCIA = 'EN_AGENCIA',
  EN_DESTINO = 'EN_DESTINO',
  ENTREGADO = 'ENTREGADO',
  DEVUELTO = 'DEVUELTO',
}

export enum TipoEnvio {
  AGENCIA = 'AGENCIA',
  DOMICILIO = 'DOMICILIO',
}

export enum TurnoEnvio {
  MANANA = 'MANANA',
  TARDE = 'TARDE',
  NOCHE = 'NOCHE',
}

/** Tipo de venta para el motorizado (cómo se entrega y si cobra). */
export const TIPOS_VENTA_REPARTO = [
  'CONTRAENTREGA',
  'SOLO_ENTREGA',
  'CAMBIO',
  'CONTRAENTREGA_CAMBIO',
  'RECOJO',
] as const;
export type TipoVentaReparto = (typeof TIPOS_VENTA_REPARTO)[number];

/** Con qué le paga el cliente al motorizado en la puerta. */
export const FORMAS_PAGO_COBRO = [
  'EFECTIVO',
  'YAPE',
  'PLIN',
  'TRANSFERENCIA',
  'POS',
  'NO_COBRAR',
] as const;
export type FormaPagoCobro = (typeof FORMAS_PAGO_COBRO)[number];

export class CreateEnvioDespachoDto {
  @IsOptional() @IsString() transportista?: string;
  @IsOptional() @IsString() codigoGuia?: string;
  @IsOptional() @IsEnum(EstadoDespacho) estado?: EstadoDespacho;
  @IsOptional() @IsString() observaciones?: string;
  @IsOptional() @IsString() direccionDestino?: string;
  @IsOptional() @IsDateString() fechaEstimada?: string;
  // Coordinación de envío nacional
  @IsOptional() @IsEnum(TipoEnvio) tipoEnvio?: TipoEnvio;
  @IsOptional() @IsString() agenciaDestino?: string;
  @IsOptional() @IsString() celularDest?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) nroPaquetes?: number;
  @IsOptional() @IsEnum(TurnoEnvio) turnoEnvio?: TurnoEnvio;
  @IsOptional() @IsString() tipoMercaderia?: string;
  @IsOptional() @IsString() claveEnvio?: string;
  @IsOptional() @IsString() nroOrden?: string;
  @IsOptional() @IsString() claveOrden?: string;
  @IsOptional() @IsString() establecimiento?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) repartidorId?: number;
  // Compatibilidad temporal: si llega texto libre, el backend crea/asigna el repartidor EVENTUAL.
  @IsOptional() @IsString() repartidor?: string;
  @IsOptional() @IsString() empaquetador?: string;
  // Datos destinatario Shalom
  @IsOptional() @IsString() nombreDestinatario?: string;
  @IsOptional() @IsString() dniDestinatario?: string;
  /**
   * Clientes dados de alta solo con WhatsApp ("WSP 9…", sin documento): al
   * completar DNI + nombre del destinatario para la guía, también se corrige
   * la ficha del cliente para que la próxima venta ya salga completa.
   */
  @IsOptional() @IsBoolean() actualizarFichaCliente?: boolean;
  @IsOptional() @IsString() contenidoPaquete?: string;
  /** type_product de Shalom elegido en la coordinación de envío. */
  @IsOptional() @Type(() => Number) @IsInt() shalomTipoProducto?: number;
  // Peso del paquete en kg: Olva lo exige para registrar la guía y cotizar.
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.1) pesoKg?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) montoCOD?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) costoEnvio?: number;
  @IsOptional() @IsIn(['CLIENTE', 'NEGOCIO']) pagarFlete?:
    | 'CLIENTE'
    | 'NEGOCIO';
  @IsOptional()
  @IsIn(['ITEM_ENVIO', 'ADELANTO', 'NEGOCIO'])
  aplicacionMontoCliente?: 'ITEM_ENVIO' | 'ADELANTO' | 'NEGOCIO';

  // ── Reparto propio / motorizado externo (plantilla de carga masiva del courier)
  @IsOptional()
  @IsIn([...TIPOS_VENTA_REPARTO])
  tipoVentaReparto?: TipoVentaReparto;
  @IsOptional() @IsString() distritoUbigeo?: string;
  @IsOptional() @IsString() distrito?: string;
  @IsOptional() @IsString() coordenadas?: string;
  @IsOptional()
  @IsIn([...FORMAS_PAGO_COBRO])
  formaPagoCobro?: FormaPagoCobro;
  @IsOptional() @IsBoolean() revisarProducto?: boolean;
}

export class UpdateEnvioDespachoDto extends CreateEnvioDespachoDto {}

export class ExportarRepartoQueryDto {
  /** Día (YYYY-MM-DD) de entrega programada; con `fechaFin` es un rango. */
  @IsOptional() @IsString() fecha?: string;
  @IsOptional() @IsString() fechaFin?: string;
  @IsOptional() @Type(() => Number) @IsInt() sedeId?: number;
  @IsOptional() @Type(() => Number) @IsInt() repartidorId?: number;
  /** Estado del despacho a incluir (por defecto todos menos DEVUELTO). */
  @IsOptional() @IsString() estado?: string;
}
