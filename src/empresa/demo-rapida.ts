import { randomInt } from 'crypto';
import type { ClaveForanea, PasoDeBorrado } from './borrado-cascada';

/**
 * Demo rápida y pase a producción desde /administrador/empresas.
 *
 * Crear una empresa pedía ~20 campos y copiar a mano el usuario y la clave
 * del PSE. Para una demo basta el RUC: SUNAT da la razón social y la
 * dirección, el PSE da las credenciales de prueba y la contraseña del dueño
 * se genera acá. Cuando el cliente compra, un clic la pasa a producción.
 */

/** Días de prueba que se pueden dar. */
export const DIAS_DEMO = [1, 7, 15, 30] as const;
export const DIAS_DEMO_POR_DEFECTO = 15;

// Sin 0/O, 1/l/I: se dicta por teléfono o WhatsApp.
const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Contraseña inicial del dueño. Se muestra una sola vez al crear la demo. */
export const contrasenaInicial = (largo = 10): string =>
  Array.from({ length: largo }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');

/** Lo que devuelve apiperu.dev para un RUC, ya listo para crear la empresa. */
export const datosDesdeSunat = (sunat: any) => {
  const razonSocial = String(sunat?.nombre_o_razon_social ?? '').trim();
  const direccion = String(sunat?.direccion_completa || sunat?.direccion || '').trim() || '-';
  const ubigeo = Array.isArray(sunat?.ubigeo) ? sunat.ubigeo[2] : sunat?.ubigeo;
  return {
    razonSocial,
    nombreComercial: razonSocial,
    direccion,
    departamento: String(sunat?.departamento ?? '').trim(),
    provincia: String(sunat?.provincia ?? '').trim(),
    distrito: String(sunat?.distrito ?? '').trim(),
    ubigeo: String(ubigeo ?? '').trim(),
    estado: String(sunat?.estado ?? '').toUpperCase(),
  };
};

export interface ClaveConRegla extends ClaveForanea {
  /** `delete_rule` de information_schema: CASCADE, SET NULL, RESTRICT, NO ACTION. */
  regla: string;
}

const comillas = (s: string) => `"${s.replace(/"/g, '""')}"`;
const seAnulaSola = (regla: string) => /^SET (NULL|DEFAULT)$/i.test(regla.trim());

/**
 * Borrar las ventas de prueba antes de pasar a producción.
 *
 * Se borran las filas de `raices` de la empresa (comprobantes, guías) y, antes,
 * todo lo que cuelga de ellas y no se resuelve solo. Las FK con SET NULL se
 * dejan a la base: por eso el kardex sigue explicando el stock (queda sin el
 * comprobante, no desaparece) y las series de producto vuelven a estar libres.
 *
 * Igual que el borrado de empresas, el orden sale de las claves foráneas
 * leídas en el momento: un módulo nuevo que cuelgue de Comprobante no rompe
 * esto sin que nadie se entere.
 */
export const planDeLimpiezaDemo = (
  fks: ClaveConRegla[],
  raices: string[] = ['Comprobante', 'GuiaRemision'],
): PasoDeBorrado[] => {
  const condicion = new Map<string, string[]>();
  const profundidad = new Map<string, number>();
  for (const r of raices) {
    condicion.set(r, [`"empresaId" = $1`]);
    profundidad.set(r, 0);
  }

  // Tope de vueltas: un ciclo de FK no puede colgar la limpieza.
  let frontera = [...raices];
  for (let vuelta = 0; vuelta < 20 && frontera.length > 0; vuelta++) {
    const siguiente = new Set<string>();
    for (const padre of frontera) {
      const donde = condicion.get(padre)!.map((c) => `(${c})`).join(' OR ');
      for (const fk of fks) {
        if (fk.padre !== padre || fk.hija === padre || seAnulaSola(fk.regla)) continue;
        if (raices.includes(fk.hija)) continue;
        const parte = `${comillas(fk.columna)} IN (SELECT ${comillas(fk.padreColumna)} FROM ${comillas(padre)} WHERE ${donde})`;
        const actuales = condicion.get(fk.hija) ?? [];
        if (!actuales.includes(parte)) condicion.set(fk.hija, [...actuales, parte]);
        const nueva = (profundidad.get(padre) ?? 0) + 1;
        if ((profundidad.get(fk.hija) ?? -1) < nueva) {
          profundidad.set(fk.hija, nueva);
          siguiente.add(fk.hija);
        }
      }
    }
    frontera = [...siguiente];
  }

  return [...condicion.entries()]
    .map(([tabla, partes]) => ({
      tabla,
      donde: partes.length === 1 ? partes[0] : partes.map((p) => `(${p})`).join(' OR '),
      profundidad: profundidad.get(tabla) ?? 0,
    }))
    .sort((a, b) => b.profundidad - a.profundidad || a.tabla.localeCompare(b.tabla));
};
