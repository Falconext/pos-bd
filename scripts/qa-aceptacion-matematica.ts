/**
 * Criterio de aceptación del cliente, textual:
 *
 *   "Auditoría Matemática: Comprobación al 100% de la regla de Packs y
 *    Volúmenes en 5 casos de prueba de carritos combinados sin desajuste de
 *    céntimos."
 *
 * Esto construye los 5 carritos combinados a mano, con el aritmética hecha
 * aparte (no reusando el motor, que es justo lo que se está auditando), y
 * compara céntimo a céntimo.
 *
 *   npx ts-node --transpile-only scripts/qa-aceptacion-matematica.ts
 */
import {
  calcularDescuento,
  REGLAS_HIERBA_SANA,
  soles,
} from '../src/leads/reglas-descuento';

interface Caso {
  nombre: string;
  items: { nombre: string; precioUnitario: number; cantidad: number }[];
  envio: number;
  /** Calculado a mano, con los tramos del documento del cliente. */
  esperado: {
    subtotal: number;
    total: number;
    unidadesValidas: number;
    descuento: number;
    montoAPagar: number;
  };
  porQue: string;
}

/**
 * Los tramos, como están en la tabla: más de S/ 90 y 3 unidades → S/ 10;
 * más de S/ 170 y 5 → S/ 20; más de S/ 250 y 7 → S/ 30. Solo cuentan las
 * unidades de más de S/ 20, y el envío suma al total.
 */
const CASOS: Caso[] = [
  {
    nombre: '1. Dos presentaciones + envío Lima (el ejemplo del documento)',
    items: [
      { nombre: 'Moringa 100 caps', precioUnitario: 31, cantidad: 2 },
      { nombre: 'Berberina gotero', precioUnitario: 60, cantidad: 1 },
    ],
    envio: 15,
    esperado: {
      subtotal: 122,
      total: 137,
      unidadesValidas: 3,
      descuento: 10,
      montoAPagar: 127,
    },
    porQue: '3 unidades válidas y total 137 > 90 → primer tramo, S/ 10.',
  },
  {
    nombre: '2. Carrito mixto con un producto de S/ 20 exactos',
    items: [
      { nombre: 'Filtrante manzanilla', precioUnitario: 20, cantidad: 3 },
      { nombre: 'Uña de gato', precioUnitario: 45, cantidad: 2 },
    ],
    envio: 15,
    esperado: {
      subtotal: 150,
      total: 165,
      // Los de S/ 20 NO cuentan: el mínimo es "más de 20", no "20 o más".
      unidadesValidas: 2,
      descuento: 0,
      montoAPagar: 165,
    },
    porQue:
      'Solo 2 unidades pasan el mínimo de S/ 20, y el primer tramo pide 3.',
  },
  {
    nombre: '3. Cinco unidades y S/ 215: el caso que separa los dos tramos',
    items: [{ nombre: 'Omega 3', precioUnitario: 40, cantidad: 5 }],
    envio: 15,
    esperado: {
      subtotal: 200,
      total: 215,
      unidadesValidas: 5,
      // 215 > 170 y 5 unidades → segundo tramo. NO se suman los tramos.
      descuento: 20,
      montoAPagar: 195,
    },
    porQue:
      '5 unidades y 215 > 170 → segundo tramo, S/ 20. Los tramos no se acumulan.',
  },
  {
    nombre: '4. Siete unidades combinadas con céntimos',
    items: [
      { nombre: 'Moringa polvo', precioUnitario: 28.5, cantidad: 4 },
      { nombre: 'Maca negra', precioUnitario: 35.9, cantidad: 3 },
    ],
    envio: 10,
    esperado: {
      // 4×28.50 = 114.00 ; 3×35.90 = 107.70
      subtotal: 221.7,
      total: 231.7,
      unidadesValidas: 7,
      // 7 unidades pero 231.70 NO supera 250 → se queda en el segundo tramo.
      descuento: 20,
      montoAPagar: 211.7,
    },
    porQue:
      '7 unidades pero el total no llega a 250: manda la condición de monto.',
  },
  {
    nombre: '5. El tramo más alto, con recojo en tienda (envío 0)',
    items: [
      { nombre: 'Berberina', precioUnitario: 60, cantidad: 3 },
      { nombre: 'Moringa', precioUnitario: 31, cantidad: 4 },
    ],
    envio: 0,
    esperado: {
      // 3×60 = 180 ; 4×31 = 124
      subtotal: 304,
      total: 304,
      unidadesValidas: 7,
      descuento: 30,
      montoAPagar: 274,
    },
    porQue: '7 unidades y 304 > 250 → tercer tramo, S/ 30, sin envío.',
  },
];

let fallos = 0;

console.log('Auditoría matemática — regla de packs y volúmenes\n');

for (const caso of CASOS) {
  const r = calcularDescuento(
    caso.items.map((i) => ({
      precioUnitario: i.precioUnitario,
      cantidad: i.cantidad,
    })),
    caso.envio,
    REGLAS_HIERBA_SANA,
  );

  const campos: (keyof typeof caso.esperado)[] = [
    'subtotal',
    'total',
    'unidadesValidas',
    'descuento',
    'montoAPagar',
  ];
  const difiere = campos.filter((c) => r[c] !== caso.esperado[c]);

  // Céntimos exactos: lo que el cliente pide es que no haya desajuste.
  const enCentimos = (n: number) => Math.round(n * 100);
  const descuadre = campos.some(
    (c) => enCentimos(r[c] as number) !== enCentimos(caso.esperado[c]),
  );

  console.log(`${difiere.length === 0 ? '✔' : '✗'} ${caso.nombre}`);
  console.log(
    `    ${caso.items.map((i) => `${i.cantidad}× ${i.nombre} ${soles(i.precioUnitario)}`).join(' + ')} + envío ${soles(caso.envio)}`,
  );
  console.log(
    `    subtotal ${soles(r.subtotal)} · total ${soles(r.total)} · ${r.unidadesValidas} unidad(es) válida(s) · descuento ${soles(r.descuento)} → a pagar ${soles(r.montoAPagar)}`,
  );
  console.log(`    ${caso.porQue}`);
  if (difiere.length) {
    fallos++;
    for (const c of difiere) {
      console.log(
        `    ↳ ${c}: calculado ${r[c]} vs esperado a mano ${caso.esperado[c]}`,
      );
    }
  }
  if (descuadre) console.log('    ↳ DESAJUSTE DE CÉNTIMOS');
  console.log();
}

const pct = Math.round(((CASOS.length - fallos) / CASOS.length) * 100);
console.log(
  `${CASOS.length - fallos}/${CASOS.length} carritos correctos — ${pct}%`,
);
console.log(
  pct === 100
    ? 'CUMPLE el criterio de aceptación: 100% sin desajuste de céntimos.'
    : 'NO cumple: el criterio del cliente exige el 100%.',
);
process.exit(fallos ? 1 : 0);
