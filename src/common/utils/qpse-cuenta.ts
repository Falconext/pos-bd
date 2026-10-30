import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { QpseClient, QpseEmpresaCuenta } from './qpse.client';

/**
 * Alta de un RUC en la cuenta de Krezka en QPSE y su pase a producción.
 *
 * Lo usan la consola de facturación (integradores) y el panel de sistema
 * (demo rápida / pasar a producción). Cada paso se puede repetir: si se corta
 * a la mitad o hacen doble clic, el segundo intento retoma donde quedó.
 */

export const mensajeQpse = (err: unknown): string =>
  String((err as any)?.message ?? err ?? '').replace(/^QPSE:\s*/, '');

export const filaQpse = async (
  qpse: QpseClient,
  ruc: string,
): Promise<QpseEmpresaCuenta | undefined> =>
  (await qpse.cuentaEmpresas()).find((f) => String(f.ruc).trim() === ruc);

/** Registra el RUC en nuestra cuenta (queda en demo) si todavía no está. */
export const registrarEnQpse = async (
  qpse: QpseClient,
  ruc: string,
): Promise<QpseEmpresaCuenta> => {
  const ya = await filaQpse(qpse, ruc);
  if (ya) return ya;
  try {
    await qpse.cuentaCrearEmpresa(ruc);
  } catch (err) {
    const msg = mensajeQpse(err);
    // Doble clic o reintento: ya la registramos nosotros. Se sigue.
    if (!/registrada en su cuenta/i.test(msg)) {
      if (/otra cuenta/i.test(msg)) {
        throw new ConflictException(
          'Ese RUC ya está afiliado con otro proveedor que usa el mismo PSE (QPSE). Para facturar con Krezka, la empresa tiene que darse de baja allí primero. Si necesitas ayuda, escríbenos.',
        );
      }
      throw new BadRequestException(`No pudimos registrar la empresa en el PSE: ${msg}`);
    }
  }
  const fila = await filaQpse(qpse, ruc);
  if (!fila) throw new ServiceUnavailableException('El PSE no confirmó el registro. Intenta de nuevo en unos minutos.');
  return fila;
};

/**
 * Deja el RUC en producción en QPSE (IRREVERSIBLE allá) y devuelve la fila con
 * el usuario y contraseña de firma. Quien llama decide cuándo pedir confirmación.
 */
export const pasarRucAProduccion = async (
  qpse: QpseClient,
  ruc: string,
): Promise<QpseEmpresaCuenta & { username: string; password: string }> => {
  let fila = await registrarEnQpse(qpse, ruc);
  if (fila.environment !== 'production') {
    try {
      await qpse.cuentaPasarAProduccion(fila.external_id);
    } catch (err) {
      const msg = mensajeQpse(err);
      if (!/ya se encuentra en producci/i.test(msg)) {
        throw new ServiceUnavailableException(`El PSE no pudo pasar la empresa a producción: ${msg}`);
      }
    }
    fila = (await filaQpse(qpse, ruc)) ?? fila;
  }
  if (!fila.username?.trim() || !fila.password?.trim()) {
    throw new ServiceUnavailableException('El PSE todavía no entregó las credenciales de firma. Intenta de nuevo en unos minutos.');
  }
  return { ...fila, username: fila.username.trim(), password: fila.password.trim() };
};
