import * as crypto from 'crypto';

/**
 * Cifrado simétrico para secretos que el sistema necesita PODER LEER de vuelta
 * (no sirve un hash): hoy, la clave SOL que exige la API del SIRE para pedir el
 * token. Se guarda cifrada para que un volcado de la base no la exponga.
 *
 * AES-256-GCM: además de cifrar, la etiqueta de autenticación detecta si el
 * texto fue alterado. Formato guardado: `v1:<iv>:<tag>:<datos>` en base64.
 *
 * La llave sale de `CREDENCIALES_SECRET`; si no está definida se deriva del
 * `JWT_SECRET` (que siempre existe) para no bloquear entornos ya desplegados.
 * Si algún día se rota esa llave, lo cifrado con la anterior deja de poder
 * descifrarse: hay que volver a pedir la clave SOL en Configuración.
 */
const PREFIJO = 'v1';

function llave(): Buffer {
  const base =
    process.env.CREDENCIALES_SECRET ||
    process.env.JWT_SECRET ||
    // Último recurso para entornos de desarrollo sin .env completo. No protege
    // nada: si se llega acá es porque tampoco hay JWT_SECRET.
    'falconext-dev-secret';
  // scrypt deja una llave de 32 bytes estable para el mismo secreto.
  return crypto.scryptSync(base, 'falconext.secreto.util', 32);
}

/** Cifra un texto. Devuelve null si viene vacío (para guardar null en la BD). */
export function cifrarSecreto(texto?: string | null): string | null {
  const plano = String(texto ?? '').trim();
  if (!plano) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', llave(), iv);
  const datos = Buffer.concat([cipher.update(plano, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIJO,
    iv.toString('base64'),
    tag.toString('base64'),
    datos.toString('base64'),
  ].join(':');
}

/**
 * Descifra lo guardado por `cifrarSecreto`. Devuelve null si no hay valor o si
 * el texto no se puede descifrar (llave rotada, dato corrupto): el llamador
 * debe tratarlo como "no configurado" y pedir la credencial de nuevo.
 */
export function descifrarSecreto(guardado?: string | null): string | null {
  const valor = String(guardado ?? '').trim();
  if (!valor) return null;
  const partes = valor.split(':');
  if (partes.length !== 4 || partes[0] !== PREFIJO) return null;
  try {
    const [, ivB64, tagB64, datosB64] = partes;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      llave(),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plano = Buffer.concat([
      decipher.update(Buffer.from(datosB64, 'base64')),
      decipher.final(),
    ]);
    return plano.toString('utf8');
  } catch {
    return null;
  }
}

/** ¿Hay un secreto guardado? (sin descifrarlo, para exponerlo al frontend.) */
export function tieneSecreto(guardado?: string | null): boolean {
  return Boolean(String(guardado ?? '').trim());
}
