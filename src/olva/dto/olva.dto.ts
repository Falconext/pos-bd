import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * Configuración Olva de la empresa. A diferencia de Shalom Pro no hay cuenta que
 * conectar (la API key es global): solo la agencia de origen desde donde despacha
 * el negocio y el opt-in del rastreo automático.
 */
export class ConfigOlvaDto {
  @IsOptional() @IsString() agenciaOrigenCodigo?: string;
  @IsOptional() @IsString() agenciaOrigenNombre?: string;
  /** Ubigeo de la agencia/dirección de origen (lo pide la cotización). */
  @IsOptional() @IsString() agenciaOrigenUbigeo?: string;
  /** Rastreo automático por cron: opt-in por empresa, igual que Shalom. */
  @IsOptional() @IsBoolean() autoTrackingActivo?: boolean;
}

/** Rastreo de una guía Olva. */
export class TrackOlvaDto {
  @IsString() trackingNumber!: string;
  /** Año de emisión (2 dígitos). También se acepta como sufijo: "2071856-26". */
  @IsOptional() @IsString() year?: string;
  /** Ignora el snapshot en caché y consulta al proveedor en vivo. */
  @IsOptional() @IsBoolean() refresh?: boolean;
}

/** Cotización previa entre dos ubigeos. */
export class CotizarOlvaDto {
  @IsString() ubigeoOrigen!: string;
  @IsString() ubigeoDestino!: string;
  /** D = domicilio, O = oficina/tienda. */
  @IsOptional() @IsIn(['D', 'O']) tipoEntrega?: 'D' | 'O';
  @IsOptional() @IsNumber() tipoEnvio?: number;
  @IsNumber() @Min(0.1) peso!: number;
  /** Tarifa de socio (la cuenta corporativa de Olva). */
  @IsOptional() @IsBoolean() tarifaSocio?: boolean;
}

/**
 * Overrides al generar la guía. Todo es opcional: por defecto se toman los datos
 * ya cargados en el despacho, el comprobante y la configuración de la empresa.
 */
export class CrearGuiaOlvaDto {
  @IsOptional() @IsString() origenCodigo?: string;
  @IsOptional() @IsString() destinoCodigo?: string;
  @IsOptional() @IsString() destinoNombre?: string;
  /** AGENCIA (entrega en oficina) | DOMICILIO (entrega en la dirección). */
  @IsOptional() @IsIn(['AGENCIA', 'DOMICILIO']) tipoEnvio?: string;
  @IsOptional() @IsString() documento?: string;
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() direccion?: string;
  @IsOptional() @IsString() referencia?: string;
  @IsOptional() @IsString() departamento?: string;
  @IsOptional() @IsString() provincia?: string;
  @IsOptional() @IsString() distrito?: string;
  @IsOptional() @IsNumber() @Min(0.1) pesoKg?: number;
  @IsOptional() @IsNumber() valorDeclarado?: number;
  @IsOptional() @IsString() contenido?: string;
  @IsOptional() @IsString() observaciones?: string;
  /** Regenerar aunque el despacho ya tenga N° de guía. */
  @IsOptional() @IsBoolean() forzar?: boolean;
}
