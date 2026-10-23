import { BadRequestException } from '@nestjs/common';
import axios from 'axios';

/**
 * Demo por rubro que la IA le entrega al prospecto (Krezka, 20-10).
 *
 * Antes se le daba a todos la demo de cómputo, y a una farmacia no le dice
 * nada ver laptops. Las cuentas son compartidas —una por rubro, la misma clave
 * para todos—: con pocos leads alcanza, y el día que se desordenen se pasa a
 * una demo propia por prospecto.
 */
export interface CuentaDemo {
  /** Cómo se le nombra al cliente ("Farmacia y botica"). */
  rubro: string;
  /** Raíces que delatan el rubro en lo que dice el cliente o en su razón social. */
  palabras: string[];
  usuario: string;
  clave: string;
}

export interface ConfigDemos {
  /** Dónde entra el prospecto (https://app.krezka.com). */
  enlace: string;
  /** A quién le llegan los datos del prospecto. Si falta, al supervisor. */
  avisarA?: string;
  cuentas: CuentaDemo[];
}

export const BLOQUE_DATOS_DEMO = [
  '*DATOS PARA CREAR TU DEMO*',
  '-Nombres y Apellidos:',
  '-Número de celular:',
  '-Correo electrónico:',
  '-RUC:',
  '-Nombre comercial:',
].join('\n');

export interface DatosDemo {
  rubro?: string;
  demo?: string;
  nombre?: string;
  celular?: string;
  correo?: string;
  ruc?: string;
  nombreComercial?: string;
}

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Lo que falta del bloque. El celular no: ya está el del WhatsApp. */
export function faltanParaDemo(d: DatosDemo): string[] {
  const faltan: string[] = [];
  if ((d.nombre ?? '').trim().split(/\s+/).filter(Boolean).length < 2)
    faltan.push('nombres y apellidos');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((d.correo ?? '').trim()))
    faltan.push('correo electrónico');
  if (!(d.ruc ?? '').trim()) faltan.push('RUC (o que te diga que aún no tiene)');
  if (!(d.rubro ?? '').trim()) faltan.push('a qué se dedica su negocio');
  return faltan;
}

/** El RUC tal como vino: 11 dígitos, "no tiene", o un número mal escrito. */
export function leerRuc(
  texto: string | undefined,
): { ruc: string } | { sinRuc: true } | { invalido: true } {
  const digitos = (texto ?? '').replace(/\D/g, '');
  if (digitos.length === 11 && /^(10|15|17|20)/.test(digitos))
    return { ruc: digitos };
  // "no tengo", "aún no", "-": sin RUC también se le da la demo.
  if (digitos.length === 0) return { sinRuc: true };
  return { invalido: true };
}

/**
 * La demo del rubro. Primero por lo que delata el texto del cliente y su
 * razón social; si nada coincide, la que el modelo eligió como la más
 * parecida (`demo`), y entonces es aproximada: el rubro no tiene demo propia.
 */
export function elegirDemo(
  cuentas: CuentaDemo[],
  d: DatosDemo & { razonSocial?: string },
): { cuenta: CuentaDemo; aproximada: boolean } | null {
  const texto = normalizar(
    [d.rubro, d.nombreComercial, d.razonSocial].filter(Boolean).join(' '),
  );
  let mejor: { cuenta: CuentaDemo; puntos: number } | null = null;
  for (const cuenta of cuentas) {
    // Al inicio de una palabra: "moto" no puede salir de "PROMOTORA".
    const puntos = cuenta.palabras.filter((p) =>
      new RegExp(
        `(^|[^a-z0-9])${normalizar(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ).test(texto),
    ).length;
    if (puntos > 0 && (!mejor || puntos > mejor.puntos))
      mejor = { cuenta, puntos };
  }
  if (mejor) return { cuenta: mejor.cuenta, aproximada: false };

  const pedida = normalizar(d.demo ?? '').trim();
  if (!pedida) return null;
  const cuenta = cuentas.find((c) => {
    const r = normalizar(c.rubro);
    return r === pedida || r.includes(pedida) || pedida.includes(r);
  });
  return cuenta ? { cuenta, aproximada: true } : null;
}

/**
 * El modelo a veces resume los accesos o se olvida la clave. Si su respuesta
 * no trae el usuario y la clave que se entregaron, van al final tal cual.
 */
export function conAccesosDemo(
  respuesta: string,
  acceso: { rubro: string; enlace: string; usuario: string; clave: string },
): string {
  if (respuesta.includes(acceso.usuario) && respuesta.includes(acceso.clave))
    return respuesta;
  return [
    respuesta.trim(),
    `Estos son tus accesos a la demo de ${acceso.rubro}:\n🔗 ${acceso.enlace}\n👤 Usuario: ${acceso.usuario}\n🔑 Clave: ${acceso.clave}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export interface RucConsultado {
  razonSocial: string;
  estado: string;
  condicion: string;
}

/**
 * Razón social y estado en SUNAT (apiperu.dev). Devuelve `null` si SUNAT no
 * lo conoce y `undefined` si la consulta falló: una caída de apiperu no puede
 * dejar al prospecto sin su demo.
 */
export async function consultarRuc(
  ruc: string,
): Promise<RucConsultado | null | undefined> {
  const token = process.env.RENIEC_TOKEN;
  if (!token) return undefined;
  try {
    const r = await axios.post(
      'https://apiperu.dev/api/ruc',
      { ruc },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      },
    );
    const data = r.data?.data;
    if (!r.data?.success || !data?.nombre_o_razon_social) return null;
    return {
      razonSocial: String(data.nombre_o_razon_social),
      estado: String(data.estado ?? ''),
      condicion: String(data.condicion ?? ''),
    };
  } catch (e: any) {
    // apiperu responde 404 si el RUC no existe y 400 si el dígito
    // verificador no cuadra: en los dos casos está mal escrito.
    if ([400, 404].includes(e?.response?.status)) return null;
    return undefined;
  }
}

/**
 * Lo que se guarda al configurar las demos. Una cuenta sin usuario o sin
 * clave se rechaza acá: guardada, la IA le entregaría al prospecto un acceso
 * a medias.
 */
export function demosValidas(d: ConfigDemos): ConfigDemos {
  const enlace = String(d?.enlace ?? '').trim();
  if (!/^https?:\/\//.test(enlace))
    throw new BadRequestException('demos.enlace debe ser una URL');
  if (!Array.isArray(d.cuentas) || d.cuentas.length === 0)
    throw new BadRequestException('demos.cuentas no puede estar vacío');
  const cuentas = d.cuentas.map((c, i) => {
    const cuenta = {
      rubro: String(c?.rubro ?? '').trim(),
      palabras: (Array.isArray(c?.palabras) ? c.palabras : [])
        .map((p) => String(p).trim())
        .filter(Boolean),
      usuario: String(c?.usuario ?? '').trim(),
      clave: String(c?.clave ?? '').trim(),
    };
    if (!cuenta.rubro || !cuenta.usuario || !cuenta.clave || !cuenta.palabras.length)
      throw new BadRequestException(
        `demos.cuentas[${i}] necesita rubro, palabras, usuario y clave`,
      );
    return cuenta;
  });
  return {
    enlace,
    ...(d.avisarA?.trim() ? { avisarA: d.avisarA.trim() } : {}),
    cuentas,
  };
}
