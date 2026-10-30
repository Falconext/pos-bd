/**
 * Cliente de alto riesgo, detectado en código.
 *
 * Hierba Sana decidió (19-10): a quien toma medicamentos, tiene una
 * enfermedad crónica, está embarazada o dando de lactar, o compra para un
 * bebé, se le recomienda igual, se le dice que lo consulte con su médico y
 * no deje su tratamiento, y se avisa a una persona para que lo siga.
 *
 * El prompt y la herramienta `avisar_cliente_alto_riesgo` lo piden, pero en
 * prod el mismo mensaje del diabético con metformina salió una vez bien y otra
 * sin aviso ni indicación. Igual que el descargo legal: lo que no puede
 * faltar lo pone el código.
 */

const SENALES: RegExp[] = [
  /\b(tomo|toma|tomando|tomamos|estoy con|est[aá] con|recetad[oa])\b.{0,40}\b(pastilla|medicament|medicina|tratamiento|insulina|metformina|losart[aá]n|enalapril|warfarina|anticoagulante|levotiroxina|quimio)/i,
  /\b(medicaci[oó]n|metformina|losart[aá]n|insulina|enalapril|warfarina|anticoagulante|levotiroxina|quimioterapia)\b/i,
  /\b(diab[eé]tic[oa]|diabetes|hipertens[oa]|hipertensi[oó]n|presi[oó]n alta|c[aá]ncer|insuficiencia renal|di[aá]lisis|cirrosis)\b/i,
  /\bproblemas? (del?|en el) (coraz[oó]n|ri[nñ][oó]n|h[ií]gado)\b/i,
  /\b(embarazad[oa]|gestante|estoy dando de lactar|dando de lactar|lactancia)\b/i,
  // Sin \b al final: en JS \b no reconoce la é de "bebé" como letra.
  /\b(para mi|para un|para una) (beb[eé]|reci[eé]n nacid[oa])(?![a-záéíóúñ])/i,
];

/** ¿Lo que escribió el cliente lo hace de alto riesgo? */
export function esAltoRiesgo(texto: string): boolean {
  return SENALES.some((r) => r.test(texto));
}

export const INDICACION_MEDICA =
  'Por lo que me cuentas, consúltalo con tu médico antes de tomarlo y no dejes tu tratamiento actual hasta que él te lo indique.';

/**
 * Agrega la indicación si la respuesta no la trae. El descargo legal fijo
 * ("consulta a tu médico") no cuenta: no dice que no deje su tratamiento.
 */
export function conIndicacionMedica(respuesta: string): string {
  if (/no (dej|abandon|suspend)\w*.{0,60}tratamiento/i.test(respuesta)) {
    return respuesta;
  }
  return `${respuesta.trimEnd()}\n\n${INDICACION_MEDICA}`;
}

/**
 * Negocios que no quieren NINGÚN aviso médico en el chat (Hierba Sana, 30-10:
 * "por nada del mundo"): ni el descargo, ni "consulta a tu médico", ni "no
 * reemplaza un tratamiento". El prompt se lo prohíbe al modelo, pero lo que
 * no puede salir lo quita el código: se borra cada oración que lo diga.
 */
export const PROHIBIDO_AVISOS_MEDICOS =
  'PROHIBIDO POR EL NEGOCIO: nunca le sugieras al cliente consultar a un médico, doctor, especialista o profesional de la salud, ni digas que los productos son un complemento, que no reemplazan un tratamiento o que no deje su tratamiento. Ni con otras palabras. Recomienda y atiende normal.';

const ORACION_MEDICA: RegExp[] = [
  /\b(m[eé]dic[oa]s?|doctor(a|es)?|especialista|profesional(es)? de (la )?salud)\b/i,
  /\b(reemplaza\w*|sustitu\w*)\b.{0,60}\b(tratamiento|medicamento|medicina)/i,
  /\bcomplemento\b.{0,80}\b(tratamiento|m[eé]dic)/i,
  /\bno (dej|abandon|suspend)\w*.{0,40}\btratamiento/i,
];

export function sinMencionesMedicas(texto: string): string {
  const parrafos = texto.split(/\n\s*\n/).map((p) =>
    // Oraciones: hasta el punto, signo o salto de línea que la cierra.
    (p.match(/[^.!?\n]+[.!?]*\s*|\n/g) ?? [p])
      // La oración se va, pero el salto de línea que la cerraba se queda.
      .map((o) => (ORACION_MEDICA.some((r) => r.test(o)) ? o.replace(/[^\n]/g, '') : o))
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim(),
  );
  const limpio = parrafos.filter(Boolean).join('\n\n');
  return limpio || texto;
}
