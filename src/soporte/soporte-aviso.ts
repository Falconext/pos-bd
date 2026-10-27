/**
 * Aviso por WhatsApp al equipo de Krezka cuando un empresario escribe al chat
 * de soporte.
 *
 * El aviso en vivo del panel solo lo ve quien tiene la bandeja abierta; con el
 * panel cerrado, el empresario esperaba sin que nadie se enterara. Este aviso
 * sale al celular del equipo, pero con dos frenos para que no se vuelva ruido:
 *  - solo con el PRIMER mensaje sin leer de la conversación (una ráfaga de
 *    cinco mensajes es un solo aviso), y
 *  - solo dentro del horario de atención. Fuera de hora el mensaje espera en
 *    la bandeja: el widget ya le dice al empresario cuándo le contestan.
 */

/** Mismo horario que el widget (frontend `soporteHorario.ts`): lun–vie 9–18, sáb 9–13. */
export function enHorarioDeSoporte(ahora: Date = new Date()): boolean {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(ahora);
  const hora = Number(partes.find((p) => p.type === 'hour')?.value);
  const dia = partes.find((p) => p.type === 'weekday')?.value;
  if (dia === 'Sun') return false;
  const cierre = dia === 'Sat' ? 13 : 18;
  return hora >= 9 && hora < cierre;
}

/** Números del equipo, de `SOPORTE_AVISO_TELEFONOS` ("51999…,51988…"). Peruanos de 9 dígitos llevan 51. */
export function telefonosDeAviso(valor: string | undefined): string[] {
  const vistos = new Set<string>();
  for (const crudo of String(valor ?? '').split(/[,;]+/)) {
    let n = crudo.replace(/\D/g, '');
    if (n.length === 9 && n.startsWith('9')) n = `51${n}`;
    if (n.length >= 10) vistos.add(n);
  }
  return [...vistos];
}

/** ¿Este mensaje amerita aviso? */
export function debeAvisar(noLeidosTrasGuardar: number, ahora: Date = new Date()): boolean {
  return noLeidosTrasGuardar === 1 && enHorarioDeSoporte(ahora);
}

export function textoDeAviso(empresa: string, autor: string, contenido: string, urlPanel: string): string {
  const corto = contenido.length > 300 ? `${contenido.slice(0, 300)}…` : contenido;
  return [
    '💬 *Nuevo mensaje de soporte*',
    '',
    `🏢 *${empresa}*`,
    `👤 ${autor}`,
    '',
    corto,
    '',
    `Respóndele desde la bandeja: ${urlPanel}/administrador/sistema/soporte`,
  ].join('\n');
}
