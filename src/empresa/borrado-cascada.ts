/**
 * Borrar una empresa y todo lo que cuelga de ella.
 *
 * El borrado anterior listaba 14 tablas a mano (comprobantes, productos,
 * clientes…) y terminaba con `empresa.delete`. Esa última instrucción chocaba
 * contra las otras tablas que nadie actualizó, y el error salía envuelto en un
 * "puede tener datos relacionados": por eso no se podía eliminar ninguna
 * empresa con movimiento.
 *
 * Medido contra la base real: de una Empresa cuelgan **118 tablas**, hasta 6
 * niveles de profundidad (Empresa → Comprobante → DetalleComprobante → …). Una
 * lista escrita a mano no se puede mantener: cada módulo nuevo —logística,
 * leads, producción— agrega tablas y vuelve a romper el borrado sin que nadie
 * se entere hasta que un admin lo intenta.
 *
 * Por eso el orden se calcula leyendo las claves foráneas de la base en el
 * momento, no de una lista. Lo que vive acá son las funciones puras; el
 * servicio solo las alimenta con los metadatos y ejecuta el plan.
 */

/** Una clave foránea tal como la devuelve `information_schema`. */
export interface ClaveForanea {
  hija: string;
  columna: string;
  padre: string;
  padreColumna: string;
}

export interface PasoDeBorrado {
  tabla: string;
  /** Condición SQL, con `$1` = id de la empresa. */
  donde: string;
  /** Distancia a Empresa. Se borra de mayor a menor. */
  profundidad: number;
}

const comillas = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * Tablas alcanzables desde Empresa siguiendo las FK hacia abajo, con su
 * profundidad máxima. La profundidad MÁXIMA y no la mínima: si una tabla se
 * alcanza por dos caminos, hay que borrarla después de su padre más profundo.
 */
export const alcanzablesDesdeEmpresa = (
  fks: ClaveForanea[],
  raiz = 'Empresa',
): Map<string, number> => {
  const hijasDe = new Map<string, ClaveForanea[]>();
  for (const fk of fks) {
    if (!hijasDe.has(fk.padre)) hijasDe.set(fk.padre, []);
    hijasDe.get(fk.padre)!.push(fk);
  }
  const profundidad = new Map<string, number>([[raiz, 0]]);
  let frontera = [raiz];
  // Tope de vueltas: una base con un ciclo de FK no puede colgar el borrado.
  for (let vuelta = 0; vuelta < 50 && frontera.length > 0; vuelta++) {
    const siguiente: string[] = [];
    for (const tabla of frontera) {
      for (const fk of hijasDe.get(tabla) ?? []) {
        if (fk.hija === tabla) continue; // auto-referencia: se borra con la tabla
        const nueva = (profundidad.get(tabla) ?? 0) + 1;
        if ((profundidad.get(fk.hija) ?? -1) < nueva) {
          profundidad.set(fk.hija, nueva);
          siguiente.push(fk.hija);
        }
      }
    }
    frontera = [...new Set(siguiente)];
  }
  profundidad.delete(raiz);
  return profundidad;
};

/**
 * Condición que identifica las filas de una tabla que pertenecen a la empresa.
 *
 * Si la tabla tiene `empresaId` se usa directo, que es el caso de 83 de las
 * 118. Las demás —detalles de comprobante, ítems de pedido— se identifican a
 * través de su padre, encadenando subconsultas hasta llegar a una que sí lo
 * tenga. Se consideran TODOS los caminos, no solo el más corto: una tabla con
 * dos FK nullables puede tener filas que cuelgan por una u otra, y dejar una
 * sola fuera deja huérfanos que después bloquean el borrado de la empresa.
 */
export const condicionDeTabla = (
  tabla: string,
  fks: ClaveForanea[],
  tieneEmpresaId: (t: string) => boolean,
  alcanzables: Map<string, number>,
  visitadas: Set<string> = new Set(),
): string | null => {
  if (tabla === 'Empresa') return `"id" = $1`;
  if (tieneEmpresaId(tabla)) return `"empresaId" = $1`;
  if (visitadas.has(tabla)) return null; // ciclo
  const marcadas = new Set(visitadas).add(tabla);

  const partes: string[] = [];
  for (const fk of fks.filter((f) => f.hija === tabla)) {
    if (fk.padre === tabla) continue; // auto-referencia
    if (fk.padre !== 'Empresa' && !alcanzables.has(fk.padre)) continue;
    const cond = condicionDeTabla(
      fk.padre,
      fks,
      tieneEmpresaId,
      alcanzables,
      marcadas,
    );
    if (!cond) continue;
    partes.push(
      `${comillas(fk.columna)} IN (SELECT ${comillas(fk.padreColumna)} FROM ${comillas(fk.padre)} WHERE ${cond})`,
    );
  }
  if (partes.length === 0) return null;
  return partes.length === 1
    ? partes[0]
    : partes.map((p) => `(${p})`).join(' OR ');
};

/**
 * El plan completo: qué borrar y en qué orden.
 *
 * De más profundo a menos profundo. Las hojas primero, la empresa al final —
 * que es lo único que el borrado anterior hacía bien.
 */
export const planDeBorrado = (
  fks: ClaveForanea[],
  tieneEmpresaId: (t: string) => boolean,
): PasoDeBorrado[] => {
  const alcanzables = alcanzablesDesdeEmpresa(fks);
  const pasos: PasoDeBorrado[] = [];
  for (const [tabla, profundidad] of alcanzables) {
    const donde = condicionDeTabla(tabla, fks, tieneEmpresaId, alcanzables);
    if (donde) pasos.push({ tabla, donde, profundidad });
  }
  pasos.sort(
    (a, b) => b.profundidad - a.profundidad || a.tabla.localeCompare(b.tabla),
  );
  pasos.push({ tabla: 'Empresa', donde: `"id" = $1`, profundidad: 0 });
  return pasos;
};

/** La sentencia de borrado de un paso, lista para ejecutar con el id. */
export const sqlDeBorrado = (paso: PasoDeBorrado): string =>
  `DELETE FROM ${comillas(paso.tabla)} WHERE ${paso.donde}`;

/** El conteo equivalente, para la vista previa. No toca nada. */
export const sqlDeConteo = (paso: PasoDeBorrado): string =>
  `SELECT COUNT(*)::int AS n FROM ${comillas(paso.tabla)} WHERE ${paso.donde}`;
