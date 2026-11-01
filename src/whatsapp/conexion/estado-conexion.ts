import type { EstadoEvolution } from '../evolution';

export type EstadoConexion =
  | 'NO_CONECTADO'
  | 'CONECTANDO'
  | 'CONECTADO'
  | 'DESCONECTADO';

export interface ConexionActual {
  estado: EstadoConexion;
  conectadoEn: Date | null;
  avisoDesconexionEn: Date | null;
}

export interface CambioConexion {
  data: {
    estado: EstadoConexion;
    conectadoEn?: Date;
    desconectadoEn?: Date | null;
    avisoDesconexionEn?: Date | null;
    numero?: string;
    nombrePerfil?: string;
  };
  /** Solo se actualiza si el estado en la base sigue siendo este (evita dobles avisos). */
  desde: EstadoConexion;
  /** Hay que avisar al dueño que se cayó la conexión (una vez por caída). */
  avisar: boolean;
}

export interface DatosPerfil {
  numero?: string | null;
  nombrePerfil?: string | null;
}

/**
 * Qué hacer con un estado que informa Evolution (webhook CONNECTION_UPDATE o
 * consulta de estado). null = nada cambia.
 *
 * - open → CONECTADO (borra el aviso para que una próxima caída vuelva a avisar).
 * - connecting estando CONECTADO → nada: es Baileys reconectando solo.
 * - close/refused estando CONECTADO → DESCONECTADO y aviso, si no se avisó ya.
 * - close/refused esperando el QR: si nunca conectó vuelve a NO_CONECTADO (el
 *   QR venció); si ya había conectado, queda DESCONECTADO sin otro aviso.
 */
export function transicion(
  actual: ConexionActual,
  estado: EstadoEvolution,
  ahora: Date,
  perfil: DatosPerfil = {},
): CambioConexion | null {
  if (estado === 'open') {
    const data: CambioConexion['data'] = {
      estado: 'CONECTADO',
      desconectadoEn: null,
      avisoDesconexionEn: null,
    };
    if (actual.estado !== 'CONECTADO' || !actual.conectadoEn)
      data.conectadoEn = ahora;
    if (perfil.numero) data.numero = perfil.numero;
    if (perfil.nombrePerfil) data.nombrePerfil = perfil.nombrePerfil;
    const sinCambios =
      actual.estado === 'CONECTADO' &&
      !data.conectadoEn &&
      !perfil.numero &&
      !perfil.nombrePerfil;
    return sinCambios ? null : { data, desde: actual.estado, avisar: false };
  }

  if (estado === 'connecting') {
    if (actual.estado === 'CONECTADO' || actual.estado === 'CONECTANDO')
      return null;
    return {
      data: { estado: 'CONECTANDO' },
      desde: actual.estado,
      avisar: false,
    };
  }

  // close / refused
  if (actual.estado === 'CONECTADO') {
    const avisar = !actual.avisoDesconexionEn;
    return {
      data: {
        estado: 'DESCONECTADO',
        desconectadoEn: ahora,
        ...(avisar ? { avisoDesconexionEn: ahora } : {}),
      },
      desde: 'CONECTADO',
      avisar,
    };
  }
  if (actual.estado === 'CONECTANDO') {
    return {
      data: { estado: actual.conectadoEn ? 'DESCONECTADO' : 'NO_CONECTADO' },
      desde: 'CONECTANDO',
      avisar: false,
    };
  }
  return null;
}

/** "51999888777@s.whatsapp.net" o "51999888777:12@s.whatsapp.net" → "51999888777". */
export function numeroDeJid(jid: unknown): string | null {
  const d = String(jid ?? '')
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');
  return d.length >= 8 ? d : null;
}

/** Nombre del evento de Evolution normalizado: "connection.update" → "CONNECTION_UPDATE". */
export function nombreEvento(e: unknown): string {
  return String(e ?? '')
    .replace(/[.-]/g, '_')
    .toUpperCase();
}

const escapar = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** Correo al dueño: su WhatsApp se desvinculó y hay que volver a escanear. */
export function correoDesconexion(p: {
  negocio: string;
  numero: string | null;
  panelUrl: string;
}) {
  const numero = p.numero ? ` (+${p.numero})` : '';
  const asunto = `Tu WhatsApp${numero} se desconectó de ${p.negocio}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td>
<h1 style="margin:0 0 12px;font-size:20px">Tu WhatsApp se desconectó</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">El WhatsApp${escapar(numero)} de <b>${escapar(p.negocio)}</b> dejó de estar vinculado. Mientras tanto, los avisos automáticos (comprobantes, despachos, avisos al equipo) no salen desde tu número.</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">Para reactivarlo, entra al panel y vuelve a escanear el código QR con tu celular (WhatsApp → Dispositivos vinculados → Vincular un dispositivo).</p>
<p style="margin:0 0 8px"><a href="${escapar(p.panelUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px">Volver a conectar</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { asunto, html };
}
