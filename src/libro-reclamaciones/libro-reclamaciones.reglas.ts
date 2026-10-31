import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { diasHabilesRestantes } from './dias-habiles';

/** Reglas puras del Libro de Reclamaciones: validación, código, token y estado. */

export const TIPOS_RECLAMACION = ['RECLAMO', 'QUEJA'] as const;
export type TipoReclamacion = (typeof TIPOS_RECLAMACION)[number];

export const TIPOS_DOCUMENTO = ['DNI', 'CE', 'PASAPORTE', 'RUC'] as const;
export type TipoDocumentoConsumidor = (typeof TIPOS_DOCUMENTO)[number];

export const TIPOS_BIEN = ['PRODUCTO', 'SERVICIO'] as const;
export type TipoBien = (typeof TIPOS_BIEN)[number];

export const ESTADOS_RECLAMACION = [
  'PENDIENTE',
  'RESPONDIDO',
  'VENCIDO',
] as const;
export type EstadoReclamacion = (typeof ESTADOS_RECLAMACION)[number];

export const LIMITES = {
  nombres: 150,
  domicilio: 250,
  telefono: 20,
  email: 150,
  apoderadoNombre: 150,
  apoderadoDocumento: 20,
  bienDescripcion: 500,
  pedidoCodigo: 60,
  detalleMin: 10,
  detalleMax: 3000,
  pedidoConsumidorMin: 5,
  pedidoConsumidorMax: 2000,
  respuestaMin: 10,
  respuestaMax: 4000,
  montoMax: 9_999_999_999.99,
} as const;

/** Lo que llega del formulario público (sin confiar en nada). */
export interface HojaEntrada {
  tipo?: unknown;
  nombres?: unknown;
  tipoDocumento?: unknown;
  numeroDocumento?: unknown;
  domicilio?: unknown;
  telefono?: unknown;
  email?: unknown;
  menorDeEdad?: unknown;
  apoderadoNombre?: unknown;
  apoderadoDocumento?: unknown;
  bienTipo?: unknown;
  bienDescripcion?: unknown;
  montoReclamado?: unknown;
  pedidoCodigo?: unknown;
  detalle?: unknown;
  pedidoConsumidor?: unknown;
  aceptaDeclaracion?: unknown;
  website?: unknown;
}

/** Hoja ya validada y normalizada, lista para guardar. */
export interface HojaValidada {
  tipo: TipoReclamacion;
  nombres: string;
  tipoDocumento: TipoDocumentoConsumidor;
  numeroDocumento: string;
  domicilio: string;
  telefono: string;
  email: string;
  menorDeEdad: boolean;
  apoderadoNombre: string | null;
  apoderadoDocumento: string | null;
  bienTipo: TipoBien;
  bienDescripcion: string;
  montoReclamado: number | null;
  pedidoCodigo: string | null;
  detalle: string;
  pedidoConsumidor: string;
  aceptaDeclaracion: true;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TELEFONO_RE = /^\+?[0-9 ()-]{6,20}$/;

const PATRON_DOCUMENTO: Record<
  TipoDocumentoConsumidor,
  { re: RegExp; mensaje: string }
> = {
  DNI: { re: /^\d{8}$/, mensaje: 'El DNI debe tener 8 dígitos.' },
  RUC: { re: /^\d{11}$/, mensaje: 'El RUC debe tener 11 dígitos.' },
  CE: {
    re: /^[A-Z0-9]{6,12}$/,
    mensaje:
      'El carné de extranjería debe tener entre 6 y 12 caracteres alfanuméricos.',
  },
  PASAPORTE: {
    re: /^[A-Z0-9]{5,15}$/,
    mensaje: 'El pasaporte debe tener entre 5 y 15 caracteres alfanuméricos.',
  },
};

/** Texto recortado y con espacios internos colapsados; '' si no es texto. */
function texto(valor: unknown): string {
  if (typeof valor !== 'string') return '';
  return valor.replace(/\s+/g, ' ').trim();
}

/** Igual que `texto`, pero respeta los saltos de línea (detalle, respuesta). */
function textoLargo(valor: unknown): string {
  if (typeof valor !== 'string') return '';
  return valor
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function esUno<T extends string>(
  valor: unknown,
  opciones: readonly T[],
): valor is T {
  return (
    typeof valor === 'string' && (opciones as readonly string[]).includes(valor)
  );
}

function booleano(valor: unknown): boolean {
  return valor === true || valor === 'true';
}

/**
 * Valida la hoja completa y la deja normalizada. Junta todos los errores en un
 * solo 400 para que el formulario los muestre de una vez.
 */
export function validarHoja(entrada: HojaEntrada): HojaValidada {
  // Honeypot: un humano no ve ese campo; si viene con algo, es un bot.
  if (texto(entrada.website) !== '') {
    throw new BadRequestException('Solicitud inválida.');
  }

  const errores: string[] = [];
  const requerido = (valor: string, campo: string, max: number) => {
    if (!valor) errores.push(`${campo} es obligatorio.`);
    else if (valor.length > max)
      errores.push(`${campo} admite como máximo ${max} caracteres.`);
  };

  const tipo = esUno(entrada.tipo, TIPOS_RECLAMACION) ? entrada.tipo : null;
  if (!tipo) errores.push('Indica si es un reclamo o una queja.');

  const nombres = texto(entrada.nombres);
  requerido(nombres, 'El nombre', LIMITES.nombres);

  const tipoDocumento = esUno(entrada.tipoDocumento, TIPOS_DOCUMENTO)
    ? entrada.tipoDocumento
    : null;
  if (!tipoDocumento) errores.push('El tipo de documento no es válido.');
  const numeroDocumento = texto(entrada.numeroDocumento)
    .replace(/\s/g, '')
    .toUpperCase();
  if (!numeroDocumento) errores.push('El número de documento es obligatorio.');
  else if (
    tipoDocumento &&
    !PATRON_DOCUMENTO[tipoDocumento].re.test(numeroDocumento)
  ) {
    errores.push(PATRON_DOCUMENTO[tipoDocumento].mensaje);
  }

  const domicilio = texto(entrada.domicilio);
  requerido(domicilio, 'El domicilio', LIMITES.domicilio);

  const telefono = texto(entrada.telefono);
  if (!telefono) errores.push('El teléfono es obligatorio.');
  else if (
    !TELEFONO_RE.test(telefono) ||
    telefono.replace(/\D/g, '').length < 6
  ) {
    errores.push('El teléfono no es válido.');
  }

  const email = texto(entrada.email).toLowerCase();
  if (!email) errores.push('El correo es obligatorio.');
  else if (email.length > LIMITES.email || !EMAIL_RE.test(email)) {
    errores.push('El correo no es válido.');
  }

  const menorDeEdad = booleano(entrada.menorDeEdad);
  let apoderadoNombre: string | null = null;
  let apoderadoDocumento: string | null = null;
  if (menorDeEdad) {
    apoderadoNombre = texto(entrada.apoderadoNombre);
    apoderadoDocumento = texto(entrada.apoderadoDocumento)
      .replace(/\s/g, '')
      .toUpperCase();
    if (!apoderadoNombre) {
      errores.push(
        'Si eres menor de edad, indica el nombre de tu padre, madre o apoderado.',
      );
    } else if (apoderadoNombre.length > LIMITES.apoderadoNombre) {
      errores.push(
        `El nombre del apoderado admite como máximo ${LIMITES.apoderadoNombre} caracteres.`,
      );
    }
    if (!apoderadoDocumento) {
      errores.push(
        'Si eres menor de edad, indica el documento de tu padre, madre o apoderado.',
      );
    } else if (!/^[A-Z0-9]{5,20}$/.test(apoderadoDocumento)) {
      errores.push('El documento del apoderado no es válido.');
    }
  }

  const bienTipo = esUno(entrada.bienTipo, TIPOS_BIEN)
    ? entrada.bienTipo
    : null;
  if (!bienTipo)
    errores.push('Indica si se trata de un producto o un servicio.');
  const bienDescripcion = texto(entrada.bienDescripcion);
  requerido(
    bienDescripcion,
    'La descripción del producto o servicio',
    LIMITES.bienDescripcion,
  );

  let montoReclamado: number | null = null;
  const montoCrudo = entrada.montoReclamado;
  if (montoCrudo !== undefined && montoCrudo !== null && montoCrudo !== '') {
    const monto =
      typeof montoCrudo === 'number'
        ? montoCrudo
        : typeof montoCrudo === 'string'
          ? Number(montoCrudo.trim())
          : Number.NaN;
    if (!Number.isFinite(monto) || monto < 0 || monto > LIMITES.montoMax) {
      errores.push('El monto reclamado no es válido.');
    } else if (Math.round(monto * 100) !== Number((monto * 100).toFixed(6))) {
      errores.push('El monto reclamado admite como máximo 2 decimales.');
    } else {
      montoReclamado = Math.round(monto * 100) / 100;
    }
  }

  const pedidoCodigo = texto(entrada.pedidoCodigo) || null;
  if (pedidoCodigo && pedidoCodigo.length > LIMITES.pedidoCodigo) {
    errores.push('El código de pedido no es válido.');
  }

  const detalle = textoLargo(entrada.detalle);
  if (
    detalle.length < LIMITES.detalleMin ||
    detalle.length > LIMITES.detalleMax
  ) {
    errores.push(
      `El detalle debe tener entre ${LIMITES.detalleMin} y ${LIMITES.detalleMax} caracteres.`,
    );
  }

  const pedidoConsumidor = textoLargo(entrada.pedidoConsumidor);
  if (
    pedidoConsumidor.length < LIMITES.pedidoConsumidorMin ||
    pedidoConsumidor.length > LIMITES.pedidoConsumidorMax
  ) {
    errores.push(
      `Lo que solicitas debe tener entre ${LIMITES.pedidoConsumidorMin} y ${LIMITES.pedidoConsumidorMax} caracteres.`,
    );
  }

  if (entrada.aceptaDeclaracion !== true) {
    errores.push('Debes aceptar la declaración para enviar la hoja.');
  }

  if (errores.length > 0 || !tipo || !tipoDocumento || !bienTipo) {
    throw new BadRequestException(errores);
  }

  return {
    tipo,
    nombres,
    tipoDocumento,
    numeroDocumento,
    domicilio,
    telefono,
    email,
    menorDeEdad,
    apoderadoNombre,
    apoderadoDocumento,
    bienTipo,
    bienDescripcion,
    montoReclamado,
    pedidoCodigo,
    detalle,
    pedidoConsumidor,
    aceptaDeclaracion: true,
  };
}

/** Respuesta del proveedor, normalizada; lanza 400 si no cumple el largo. */
export function validarRespuesta(valor: unknown): string {
  const respuesta = textoLargo(valor);
  if (
    respuesta.length < LIMITES.respuestaMin ||
    respuesta.length > LIMITES.respuestaMax
  ) {
    throw new BadRequestException(
      `La respuesta debe tener entre ${LIMITES.respuestaMin} y ${LIMITES.respuestaMax} caracteres.`,
    );
  }
  return respuesta;
}

/** `2026-000001`: año de Lima + correlativo de 6 dígitos. */
export function formatearCodigo(anio: number, correlativo: number): string {
  if (
    !Number.isInteger(correlativo) ||
    correlativo < 1 ||
    correlativo > 999_999
  ) {
    throw new RangeError(`Correlativo fuera de rango: ${correlativo}`);
  }
  return `${anio}-${String(correlativo).padStart(6, '0')}`;
}

export const CODIGO_RE = /^\d{4}-\d{6}$/;

/** Token aleatorio para abrir la constancia sin sesión (se entrega una sola vez). */
export function generarTokenConstancia(): string {
  return randomBytes(24).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Compara en tiempo constante el token recibido con el hash guardado. */
export function verificarTokenConstancia(
  token: unknown,
  hashGuardado: string,
): boolean {
  if (typeof token !== 'string' || token.length === 0 || token.length > 200)
    return false;
  const recibido = Buffer.from(hashToken(token), 'hex');
  const guardado = Buffer.from(hashGuardado, 'hex');
  if (recibido.length !== guardado.length || guardado.length === 0)
    return false;
  return timingSafeEqual(recibido, guardado);
}

/** VENCIDO no se guarda: es un PENDIENTE cuya fecha límite ya pasó. */
export function estadoDerivado(
  estado: 'PENDIENTE' | 'RESPONDIDO',
  fechaLimite: Date,
  ahora: Date = new Date(),
): EstadoReclamacion {
  if (estado === 'RESPONDIDO') return 'RESPONDIDO';
  return ahora.getTime() > fechaLimite.getTime() ? 'VENCIDO' : 'PENDIENTE';
}

/** Fila tal como sale de Prisma (con `respondidoPor` incluido). */
export interface FilaReclamacion {
  id: number;
  codigo: string;
  tipo: string;
  estado: 'PENDIENTE' | 'RESPONDIDO';
  proveedorRazonSocial: string;
  proveedorRuc: string;
  proveedorDireccion: string;
  proveedorNombreComercial: string | null;
  nombres: string;
  tipoDocumento: string;
  numeroDocumento: string;
  domicilio: string;
  telefono: string;
  email: string;
  menorDeEdad: boolean;
  apoderadoNombre: string | null;
  apoderadoDocumento: string | null;
  bienTipo: string;
  bienDescripcion: string;
  montoReclamado: { toString(): string } | number | null;
  pedidoCodigo: string | null;
  detalle: string;
  pedidoConsumidor: string;
  aceptaDeclaracion: boolean;
  fecha: Date;
  fechaLimite: Date;
  respuesta: string | null;
  fechaRespuesta: Date | null;
  respondidoPor?: { id: number; nombre: string } | null;
}

/** Lo que ven el panel web y la app (nunca el hash del token, la IP ni el user-agent). */
export interface Reclamo {
  id: number;
  codigo: string;
  tipo: string;
  estado: EstadoReclamacion;
  proveedor: {
    razonSocial: string;
    ruc: string;
    direccion: string;
    nombreComercial: string | null;
  };
  nombres: string;
  tipoDocumento: string;
  numeroDocumento: string;
  domicilio: string;
  telefono: string;
  email: string;
  menorDeEdad: boolean;
  apoderadoNombre: string | null;
  apoderadoDocumento: string | null;
  bienTipo: string;
  bienDescripcion: string;
  montoReclamado: number | null;
  pedidoCodigo: string | null;
  detalle: string;
  pedidoConsumidor: string;
  aceptaDeclaracion: boolean;
  fecha: Date;
  fechaLimite: Date;
  diasHabilesRestantes: number | null;
  respuesta: string | null;
  fechaRespuesta: Date | null;
  respondidoPor: { id: number; nombre: string } | null;
}

export function aReclamo(
  fila: FilaReclamacion,
  ahora: Date = new Date(),
): Reclamo {
  const estado = estadoDerivado(fila.estado, fila.fechaLimite, ahora);
  return {
    id: fila.id,
    codigo: fila.codigo,
    tipo: fila.tipo,
    estado,
    proveedor: {
      razonSocial: fila.proveedorRazonSocial,
      ruc: fila.proveedorRuc,
      direccion: fila.proveedorDireccion,
      nombreComercial: fila.proveedorNombreComercial,
    },
    nombres: fila.nombres,
    tipoDocumento: fila.tipoDocumento,
    numeroDocumento: fila.numeroDocumento,
    domicilio: fila.domicilio,
    telefono: fila.telefono,
    email: fila.email,
    menorDeEdad: fila.menorDeEdad,
    apoderadoNombre: fila.apoderadoNombre,
    apoderadoDocumento: fila.apoderadoDocumento,
    bienTipo: fila.bienTipo,
    bienDescripcion: fila.bienDescripcion,
    montoReclamado:
      fila.montoReclamado === null
        ? null
        : Number(fila.montoReclamado.toString()),
    pedidoCodigo: fila.pedidoCodigo,
    detalle: fila.detalle,
    pedidoConsumidor: fila.pedidoConsumidor,
    aceptaDeclaracion: fila.aceptaDeclaracion,
    fecha: fila.fecha,
    fechaLimite: fila.fechaLimite,
    diasHabilesRestantes:
      fila.estado === 'RESPONDIDO'
        ? null
        : diasHabilesRestantes(fila.fechaLimite, ahora),
    respuesta: fila.respuesta,
    fechaRespuesta: fila.fechaRespuesta,
    respondidoPor: fila.respondidoPor ?? null,
  };
}

/** Dirección del proveedor en una línea: calle + distrito, provincia, departamento. */
export function direccionCompleta(e: {
  direccion?: string | null;
  distrito?: string | null;
  provincia?: string | null;
  departamento?: string | null;
}): string {
  const base = texto(e.direccion);
  const zona = [e.distrito, e.provincia, e.departamento]
    .map((v) => texto(v))
    .filter((v) => v && !base.toUpperCase().includes(v.toUpperCase()));
  return [base, zona.join(', ')].filter(Boolean).join(' - ');
}
