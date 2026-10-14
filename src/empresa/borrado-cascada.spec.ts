/**
 * El plan para borrar una empresa.
 *
 * El borrado anterior listaba 14 tablas a mano y terminaba con
 * `empresa.delete`. Contra la base real, de una Empresa cuelgan 118 tablas
 * hasta 6 niveles de profundidad: esa última instrucción chocaba siempre
 * contra alguna de las otras 104 y el admin veía "puede tener datos
 * relacionados" sin saber cuál.
 *
 * Lo que se defiende acá es el ORDEN y la COBERTURA: que las hijas se borren
 * antes que sus padres, que la empresa quede al final, y que ninguna tabla
 * alcanzable se quede fuera. Si algo de eso falla, el borrado se cae a la
 * mitad y deja una empresa despedazada, que es peor que no haber borrado.
 */
import {
  ClaveForanea,
  alcanzablesDesdeEmpresa,
  condicionDeTabla,
  planDeBorrado,
  sqlDeBorrado,
  sqlDeConteo,
} from './borrado-cascada';

/** Una miniatura del esquema real, con sus mismas formas. */
const FKS: ClaveForanea[] = [
  // Empresa → hijas directas (tienen empresaId)
  { hija: 'Comprobante', columna: 'empresaId', padre: 'Empresa', padreColumna: 'id' },
  { hija: 'Producto', columna: 'empresaId', padre: 'Empresa', padreColumna: 'id' },
  { hija: 'Usuario', columna: 'empresaId', padre: 'Empresa', padreColumna: 'id' },
  // Nietas: NO tienen empresaId, cuelgan de su padre
  { hija: 'DetalleComprobante', columna: 'comprobanteId', padre: 'Comprobante', padreColumna: 'id' },
  { hija: 'DetalleComprobante', columna: 'productoId', padre: 'Producto', padreColumna: 'id' },
  { hija: 'MovimientoKardex', columna: 'productoId', padre: 'Producto', padreColumna: 'id' },
  // Bisnieta
  { hija: 'SerieVendida', columna: 'detalleId', padre: 'DetalleComprobante', padreColumna: 'id' },
  // Auto-referencia: una nota de crédito apunta a otro comprobante
  { hija: 'Comprobante', columna: 'comprobanteOrigenId', padre: 'Comprobante', padreColumna: 'id' },
  // Tabla global que NO cuelga de la empresa
  { hija: 'Empresa', columna: 'planId', padre: 'Plan', padreColumna: 'id' },
];

const CON_EMPRESA_ID = new Set(['Comprobante', 'Producto', 'Usuario']);
const tieneEmpresaId = (t: string) => CON_EMPRESA_ID.has(t);

describe('qué tablas cuelgan de la empresa', () => {
  const alcanzables = alcanzablesDesdeEmpresa(FKS);

  it('encuentra hijas, nietas y bisnietas', () => {
    expect([...alcanzables.keys()].sort()).toEqual([
      'Comprobante',
      'DetalleComprobante',
      'MovimientoKardex',
      'Producto',
      'SerieVendida',
      'Usuario',
    ]);
  });

  it('no arrastra tablas globales como Plan', () => {
    // Plan es PADRE de Empresa, no hija: borrarlo se llevaría los planes de
    // todos los demás clientes.
    expect(alcanzables.has('Plan')).toBe(false);
  });

  it('a una tabla alcanzable por dos caminos le deja la profundidad MAYOR', () => {
    // DetalleComprobante cuelga de Comprobante y de Producto, los dos a
    // profundidad 1, así que queda en 2. Si se quedara con la menor podría
    // intentar borrarse antes que un padre más profundo.
    expect(alcanzables.get('DetalleComprobante')).toBe(2);
    expect(alcanzables.get('SerieVendida')).toBe(3);
  });

  it('la auto-referencia no genera profundidad infinita', () => {
    // Un comprobante apunta a otro comprobante: si se siguiera esa arista, el
    // recorrido no terminaría nunca.
    expect(alcanzables.get('Comprobante')).toBe(1);
  });
});

describe('cómo se identifican las filas de cada tabla', () => {
  const alcanzables = alcanzablesDesdeEmpresa(FKS);
  const cond = (t: string) =>
    condicionDeTabla(t, FKS, tieneEmpresaId, alcanzables);

  it('las que tienen empresaId van directo', () => {
    expect(cond('Producto')).toBe('"empresaId" = $1');
  });

  it('las que no, cuelgan por TODOS sus caminos', () => {
    // Con un solo camino quedarían filas huérfanas: un detalle cuyo producto
    // es de la empresa pero cuyo comprobante ya se borró, por ejemplo. Esas
    // filas después bloquean el borrado de la empresa.
    const c = cond('DetalleComprobante')!;
    expect(c).toContain('"comprobanteId" IN');
    expect(c).toContain('"productoId" IN');
    expect(c).toContain(' OR ');
  });

  it('la bisnieta encadena hasta llegar a empresaId', () => {
    const c = cond('SerieVendida')!;
    expect(c).toContain('"detalleId" IN');
    expect(c).toContain('"empresaId" = $1');
  });

  it('la empresa se identifica por su id', () => {
    expect(cond('Empresa')).toBe('"id" = $1');
  });
});

describe('el orden del plan', () => {
  const plan = planDeBorrado(FKS, tieneEmpresaId);
  const posicion = (t: string) => plan.findIndex((p) => p.tabla === t);

  it('la empresa se borra al final', () => {
    expect(plan[plan.length - 1].tabla).toBe('Empresa');
  });

  it('cada hija va antes que su padre', () => {
    expect(posicion('SerieVendida')).toBeLessThan(posicion('DetalleComprobante'));
    expect(posicion('DetalleComprobante')).toBeLessThan(posicion('Comprobante'));
    expect(posicion('MovimientoKardex')).toBeLessThan(posicion('Producto'));
    expect(posicion('Comprobante')).toBeLessThan(posicion('Empresa'));
  });

  it('no deja fuera ninguna tabla alcanzable', () => {
    // Es exactamente lo que rompía antes: la lista a mano cubría 14 de 118.
    const alcanzables = [...alcanzablesDesdeEmpresa(FKS).keys()];
    for (const t of alcanzables) expect(posicion(t)).toBeGreaterThanOrEqual(0);
  });

  it('cada tabla aparece una sola vez', () => {
    const vistas = plan.map((p) => p.tabla);
    expect(new Set(vistas).size).toBe(vistas.length);
  });
});

describe('las sentencias', () => {
  const plan = planDeBorrado(FKS, tieneEmpresaId);
  const paso = (t: string) => plan.find((p) => p.tabla === t)!;

  it('el borrado lleva el id como parámetro, no pegado al texto', () => {
    // Concatenar el id dejaría la consulta abierta a inyección y además
    // impediría que Postgres reutilice el plan.
    const sql = sqlDeBorrado(paso('Producto'));
    expect(sql).toBe('DELETE FROM "Producto" WHERE "empresaId" = $1');
    expect(sql).not.toMatch(/\d{2,}/);
  });

  it('el conteo mira exactamente las mismas filas que borraría', () => {
    const p = paso('DetalleComprobante');
    expect(sqlDeConteo(p)).toContain(p.donde);
    expect(sqlDeConteo(p)).toMatch(/^SELECT COUNT/);
  });

  it('los nombres van entre comillas: hay tablas en minúscula', () => {
    // combos, grupos_modificadores, producto_codigos_barras existen así en la
    // base; sin comillas Postgres no las encuentra.
    const fks: ClaveForanea[] = [
      { hija: 'producto_codigos_barras', columna: 'empresaId', padre: 'Empresa', padreColumna: 'id' },
    ];
    const sql = sqlDeBorrado(planDeBorrado(fks, () => true)[0]);
    expect(sql).toContain('"producto_codigos_barras"');
  });
});

describe('una base con un ciclo de claves foráneas no cuelga el borrado', () => {
  it('termina igual', () => {
    const ciclo: ClaveForanea[] = [
      { hija: 'A', columna: 'empresaId', padre: 'Empresa', padreColumna: 'id' },
      { hija: 'B', columna: 'aId', padre: 'A', padreColumna: 'id' },
      { hija: 'A', columna: 'bId', padre: 'B', padreColumna: 'id' },
    ];
    const plan = planDeBorrado(ciclo, (t) => t === 'A');
    expect(plan[plan.length - 1].tabla).toBe('Empresa');
    expect(plan.map((p) => p.tabla)).toContain('B');
  });
});
