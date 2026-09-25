import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * Datos del usuario dueño de la empresa.
 *
 * DEBE quedar declarada ANTES de `UpdateEmpresaDto`: con `emitDecoratorMetadata`
 * el `design:type` de la propiedad `usuario` se evalúa al decorar esa clase, y
 * si esta todavía no existe el módulo revienta al importarse
 * ("Cannot access 'UpdateEmpresaUsuarioDto' before initialization").
 */
export class UpdateEmpresaUsuarioDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  dni?: string;

  @IsOptional()
  @IsString()
  celular?: string;
}

export class UpdateEmpresaDto {
  @IsInt()
  id: number;

  @IsOptional()
  @IsString()
  ruc?: string;

  @IsOptional()
  @IsString()
  razonSocial?: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsInt()
  planId?: number;

  @IsOptional()
  @IsString()
  tipoEmpresa?: 'FORMAL' | 'INFORMAL';

  // Régimen tributario SUNAT. En RUS solo se permiten boletas (no factura).
  @IsOptional()
  @IsIn(['GENERAL', 'RER', 'MYPE', 'RUS'])
  regimenTributario?: 'GENERAL' | 'RER' | 'MYPE' | 'RUS';

  @IsOptional()
  @IsString()
  departamento?: string;

  @IsOptional()
  @IsString()
  provincia?: string;

  @IsOptional()
  @IsString()
  distrito?: string;

  @IsOptional()
  @IsString()
  ubigeo?: string;

  @IsOptional()
  @IsInt()
  rubroId?: number;

  @IsOptional()
  @IsString()
  nombreComercial?: string;

  @IsOptional()
  @IsString()
  paginaWeb?: string;

  @IsOptional()
  @IsString()
  cuentaDetraccionBN?: string;

  @IsOptional()
  @IsString()
  fechaActivacion?: string;

  @IsOptional()
  @IsString()
  fechaExpiracion?: string;

  // Seguimiento de onboarding (clientes mensuales/anuales)
  @IsOptional()
  @IsBoolean()
  capacitacion?: boolean;

  @IsOptional()
  @IsBoolean()
  altaSunat?: boolean;

  @IsOptional()
  @IsBoolean()
  contrato?: boolean;

  @IsOptional()
  @IsBoolean()
  bienvenidaRedes?: boolean;

  @IsOptional()
  @IsString()
  providerToken?: string;

  @IsOptional()
  @IsBoolean()
  esAgenteRetencion?: boolean;

  @IsOptional()
  @IsBoolean()
  cotizMostrarEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  cotizMostrarCuentas?: boolean;

  @IsOptional()
  @IsBoolean()
  cotizMostrarRazonSocial?: boolean;

  @IsOptional()
  @IsBoolean()
  cotizMostrarDetraccion?: boolean;

  @IsOptional()
  @IsObject()
  cotizFormatoConfig?: Record<string, { visible?: boolean; size?: number }>;

  // Textos por defecto recordados para próximas cotizaciones
  @IsOptional()
  @IsString()
  cotizTerminosDefault?: string;

  @IsOptional()
  @IsString()
  cotizObservacionesDefault?: string;

  /** Observaciones por defecto de la venta (se precargan en el POS para todas las cajas). */
  @IsOptional()
  @IsString()
  ventaObservacionesDefault?: string;

  /** POS: mantener la búsqueda al agregar un producto (seguir agregando de la misma lista). */
  @IsOptional()
  @IsBoolean()
  posMantenerBusqueda?: boolean;

  /** POS: comprobante con el que arranca cada venta (MANTENER_ULTIMO | NOTA_DE_VENTA | BOLETA | FACTURA). */
  @IsOptional()
  @IsIn(['MANTENER_ULTIMO', 'NOTA_DE_VENTA', 'BOLETA', 'FACTURA'])
  posComprobanteDefault?: 'MANTENER_ULTIMO' | 'NOTA_DE_VENTA' | 'BOLETA' | 'FACTURA';

  /** POS: con Yape/Plin/Transferencia/Tarjeta exigir Boleta/Factura (no comprobante interno). */
  @IsOptional()
  @IsBoolean()
  posExigirCpeMedioPago?: boolean;

  @IsOptional()
  @IsObject()
  notaVentaFormatoConfig?: Record<string, { visible?: boolean; size?: number }>;

  @IsOptional()
  @IsObject()
  facturaFormatoConfig?: Record<string, { visible?: boolean; size?: number }>;

  @IsOptional()
  @IsObject()
  boletaFormatoConfig?: Record<string, { visible?: boolean; size?: number }>;

  // ── Impresión de comprobantes (Perfil → Configuración) ────────────────────
  /** QR de SUNAT al pie del comprobante (ticket / A4 / A5). */
  @IsOptional()
  @IsBoolean()
  mostrarQrSunat?: boolean;

  @IsOptional()
  @IsBoolean()
  mostrarMarcaSistema?: boolean;

  @IsOptional()
  @IsBoolean()
  kitsComoUnaLinea?: boolean;

  @IsOptional()
  @IsBoolean()
  paquetesComoUnaLinea?: boolean;

  /** Catálogo independiente por sede: un producto nuevo solo queda disponible en la sede que lo crea. */
  @IsOptional()
  @IsBoolean()
  catalogoPorSede?: boolean;

  /** Formato preseleccionado al imprimir: TICKET | A4 | A5. */
  @IsOptional()
  @IsIn(['TICKET', 'A4', 'A5'])
  formatoImpresionDefault?: 'TICKET' | 'A4' | 'A5';

  /** Abrir el diálogo de impresión apenas se emite el comprobante. */
  @IsOptional()
  @IsBoolean()
  imprimirAutomatico?: boolean;

  @IsOptional()
  @IsBoolean()
  usaCodigoBarrasManual?: boolean;

  @IsOptional()
  @IsInt()
  ticketLogoSize?: number;

  @IsOptional()
  @IsBoolean()
  usarPrecioLoteFefo?: boolean;

  @IsOptional()
  @IsBoolean()
  permitirVentaSinStock?: boolean;

  // Modo offline-first de la app móvil (se activa por empresa desde el panel de sistema).
  @IsOptional()
  @IsBoolean()
  offlineHabilitado?: boolean;

  @IsOptional()
  @IsBoolean()
  cobranzaCampo?: boolean;

  @IsOptional()
  @IsBoolean()
  requiereAprobacionGastos?: boolean;

  @IsOptional()
  @IsBoolean()
  requiereAprobacionCompras?: boolean;

  // Criterio del IGV en el Análisis Financiero: ELECTRONICOS | TODOS | NINGUNO.
  @IsOptional()
  @IsIn(['ELECTRONICOS', 'TODOS', 'NINGUNO'])
  criterioIgvVentas?: 'ELECTRONICOS' | 'TODOS' | 'NINGUNO';

  // Ley de Amazonía (Ley 27037): agrega a los comprobantes la leyenda 2000
  // del Catálogo 52 que sustenta la exoneración del IGV en la zona.
  @IsOptional()
  @IsBoolean()
  leyAmazonia?: boolean;

  @IsOptional()
  @IsBoolean()
  requiereCajaParaEmitir?: boolean;

  @IsOptional()
  @IsString()
  directorTecnico?: string;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['QPSE', 'APISUNAT', 'JAMBLE'])
  billingProvider?: 'QPSE' | 'APISUNAT' | 'JAMBLE';

  @IsOptional()
  @IsString()
  billingApiBaseUrl?: string;

  @IsOptional()
  @IsString()
  billingApiDemoBaseUrl?: string;

  @IsOptional()
  @IsString()
  billingApiToken?: string;

  @IsOptional()
  @IsString()
  billingApiUser?: string;

  @IsOptional()
  @IsString()
  billingApiPassword?: string;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  bancoNombre?: string;

  @IsOptional()
  @IsString()
  numeroCuenta?: string;

  @IsOptional()
  @IsString()
  cci?: string;

  @IsOptional()
  @IsString()
  monedaCuenta?: string;

  @IsOptional()
  @IsString()
  yapeNumero?: string;

  @IsOptional()
  @IsString()
  yapeQrUrl?: string;

  @IsOptional()
  @IsString()
  plinNumero?: string;

  @IsOptional()
  @IsString()
  plinQrUrl?: string;

  @IsOptional()
  @IsString()
  @IsIn(['falconext', 'krezka'])
  brand?: string;

  @IsOptional()
  @IsString()
  @IsIn(['facturacion', 'hotel', 'restaurante', 'logistica'])
  producto?: string;

  @IsOptional()
  @IsString()
  usuarioPse?: string;

  @IsOptional()
  @IsString()
  contrasenaPse?: string;

  // Credenciales de API "Consulta de Validez de CPE" de SUNAT (portal SOL).
  @IsOptional()
  @IsString()
  sunatClientId?: string;

  @IsOptional()
  @IsString()
  sunatClientSecret?: string;

  // ── Pasarelas de pago de la tienda (credenciales del propio comerciante) ──
  @IsOptional()
  @IsString()
  culqiPublicKey?: string;

  @IsOptional()
  @IsString()
  culqiSecretKey?: string;

  @IsOptional()
  @IsBoolean()
  culqiActivo?: boolean;

  @IsOptional()
  @IsString()
  niubizMerchantId?: string;

  @IsOptional()
  @IsString()
  niubizUsuario?: string;

  @IsOptional()
  @IsString()
  niubizPassword?: string;

  @IsOptional()
  @IsBoolean()
  niubizActivo?: boolean;

  @IsOptional()
  @IsBoolean()
  pasarelasUsaDemo?: boolean;

  // Credenciales de API del SIRE (se generan aparte; ver sire.client.ts).
  @IsOptional()
  @IsString()
  sireClientId?: string;

  @IsOptional()
  @IsString()
  sireClientSecret?: string;

  @IsOptional()
  @IsString()
  sireUsuarioSol?: string;

  /** Clave SOL en claro solo de entrada: se guarda cifrada y nunca se devuelve. */
  @IsOptional()
  @IsString()
  sireClaveSol?: string;

  @IsOptional()
  @IsString()
  @IsIn(['PLATFORM', 'EMPRESA', 'DISABLED'])
  whatsappProvider?: 'PLATFORM' | 'EMPRESA' | 'DISABLED';

  @IsOptional()
  @IsString()
  whatsappApiToken?: string;

  @IsOptional()
  @IsString()
  whatsappPhoneNumberId?: string;

  @IsOptional()
  @IsString()
  whatsappBusinessId?: string;

  @IsOptional()
  @IsBoolean()
  whatsappActivo?: boolean;

  // Credenciales de Shalom Pro (courier) — por empresa.
  @IsOptional()
  @IsString()
  shalomEmail?: string;

  @IsOptional()
  @IsString()
  shalomPassword?: string;

  @IsOptional()
  @IsBoolean()
  usaDemo?: boolean;

  @IsOptional()
  usuario?: UpdateEmpresaUsuarioDto;
}

/**
 * Marcado de onboarding desde el listado de Empresas (ADMIN_SISTEMA).
 * Es un DTO propio y no el `UpdateEmpresaDto` completo: así un clic en el check
 * no puede tocar por accidente ningún otro campo de la empresa.
 */
export class OnboardingEmpresaDto {
  @IsIn(['capacitacion', 'altaSunat', 'contrato', 'bienvenidaRedes'])
  campo!: 'capacitacion' | 'altaSunat' | 'contrato' | 'bienvenidaRedes';

  @IsBoolean()
  valor!: boolean;
}
