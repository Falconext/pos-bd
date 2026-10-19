/**
 * El nombre del negocio, bien escrito.
 *
 * El modelo de chat (flash-lite) lo deforma: en el banco de pruebas del 19-10
 * salió "Hígerba Sana", "Híerba Sana", "Híerva Sana" y "Híper San..." en 5 de
 * 15 conversaciones. Se corrige en código: cualquier secuencia de palabras que
 * se parezca al nombre (distancia de edición corta) pero no sea igual se
 * reemplaza por el nombre tal como lo registró el negocio.
 */

function sinTildes(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function distancia(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length][b.length];
}

/** "HIERBA SANA" → "Hierba Sana". */
function enTitulo(nombre: string): string {
  return nombre
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, sp, l) => sp + l.toUpperCase());
}

export function conNombreBienEscrito(
  texto: string,
  nombre: string | null | undefined,
): string {
  const limpio = nombre?.trim();
  if (!limpio || limpio.length < 6) return texto;
  const k = limpio.split(/\s+/).length;
  const objetivo = sinTildes(limpio);
  // Hasta 2 errores en nombres cortos, 3 en largos.
  const tolerancia = objetivo.length >= 12 ? 3 : 2;
  const canon = limpio === limpio.toUpperCase() ? enTitulo(limpio) : limpio;

  // Ventana de k palabras que avanza de a una (no de a k: así siempre cae
  // alineada con el nombre, esté donde esté).
  const palabras = [...texto.matchAll(/\p{L}+/gu)].map((m) => ({
    ini: m.index!,
    fin: m.index! + m[0].length,
  }));
  const cambios: { ini: number; fin: number }[] = [];
  for (let i = 0; i + k <= palabras.length; i++) {
    const ini = palabras[i].ini;
    const fin = palabras[i + k - 1].fin;
    const tramo = texto.slice(ini, fin);
    if (!/^[\p{L}\s]+$/u.test(tramo)) continue; // nada de puntuación en medio
    const n = sinTildes(tramo).replace(/\s+/g, ' ');
    const yaBien = n === objetivo && tramo === sinTildesConCaja(tramo);
    if (yaBien || n[0] !== objetivo[0]) continue;
    if (distancia(n, objetivo) <= tolerancia) {
      cambios.push({ ini, fin });
      i += k - 1;
    }
  }
  let r = texto;
  for (const c of cambios.reverse()) r = r.slice(0, c.ini) + canon + r.slice(c.fin);
  return r;
}

function sinTildesConCaja(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
