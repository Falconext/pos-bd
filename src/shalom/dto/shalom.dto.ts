import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Conexión de la cuenta Shalom Pro del negocio (plan Corporativo).
 * `username`/`password` son las credenciales de pro.shalom.pe del cliente.
 */
export class ConectarInstanciaDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() password?: string;
  /** Código de seguridad de la cuenta (lo pide el registro masivo). */
  @IsOptional() @IsString() securityCode?: string;
  /** Agencia por defecto desde donde despacha el negocio. */
  @IsOptional() @IsString() agenciaOrigenId?: string;
  @IsOptional() @IsString() agenciaOrigenNombre?: string;
}

/** Ajustes de la instancia que no requieren volver a loguear. */
export class ConfigInstanciaDto {
  @IsOptional() @IsString() securityCode?: string;
  @IsOptional() @IsString() agenciaOrigenId?: string;
  @IsOptional() @IsString() agenciaOrigenNombre?: string;
}

/**
 * Overrides al generar la guía. Todo es opcional: por defecto se toman los datos
 * ya cargados en el despacho y en el comprobante.
 */
export class CrearGuiaDto {
  @IsOptional() @IsString() origenId?: string;
  @IsOptional() @IsString() origenNombre?: string;
  @IsOptional() @IsString() destinoId?: string;
  @IsOptional() @IsString() destinoNombre?: string;
  @IsOptional() @IsString() dni?: string;
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() direccion?: string;
  /** Regenerar aunque el despacho ya tenga N° de orden. */
  @IsOptional() @IsBoolean() forzar?: boolean;
}

/** Cotización previa entre dos agencias. */
export class QuoteDto {
  @IsNumber() origin!: number;
  @IsNumber() destination!: number;
}
