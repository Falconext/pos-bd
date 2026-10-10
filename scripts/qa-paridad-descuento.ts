/**
 * D2 — ¿el carrito y la IA dicen lo mismo?
 *
 * Son dos implementaciones distintas (TS de backend y TS de frontend) del
 * mismo reglamento. Dos implementaciones es exactamente la situación en la
 * que los números se separan sin que nadie lo note, así que esto las corre
 * sobre miles de carritos al azar y compara céntimo a céntimo.
 *
 *   npx ts-node --transpile-only scripts/qa-paridad-descuento.ts
 */
import {
  calcularDescuento as backend,
  REGLAS_HIERBA_SANA,
} from '../src/leads/reglas-descuento';
// El frontend es un paquete ESM y este script corre en CommonJS; se compila
// el módulo al vuelo en vez de duplicar el archivo (una copia se desactualiza
// y entonces el test dejaría de medir lo que de verdad corre en la tienda).
const frontend = cargarDelCarrito();

function cargarDelCarrito() {
  const ts = require('typescript') as typeof import('typescript');
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const archivo = path.join(
    __dirname,
    '..',
    '..',
    'frontend',
    'src',
    'utils',
    'reglasDescuento.ts',
  );
  const js = ts.transpileModule(fs.readFileSync(archivo, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function('exports', 'module', 'require', js)(mod.exports, mod, require);
  return mod.exports.calcularDescuento as typeof backend;
}

const CARRITOS = 5000;
/** Precios que de verdad existen en el catálogo de Hierba Sana. */
const PRECIOS = [15, 18, 20, 25, 31, 35, 40, 45, 50, 60, 85];
const ENVIOS = [0, 10, 15];

let distintos = 0;
const muestras: string[] = [];

for (let n = 0; n < CARRITOS; n++) {
  const items = Array.from(
    { length: 1 + Math.floor(Math.random() * 5) },
    () => ({
      precioUnitario: PRECIOS[Math.floor(Math.random() * PRECIOS.length)],
      cantidad: 1 + Math.floor(Math.random() * 4),
    }),
  );
  const envio = ENVIOS[Math.floor(Math.random() * ENVIOS.length)];

  const b = backend(items, envio, REGLAS_HIERBA_SANA);
  const f = frontend(items, envio, REGLAS_HIERBA_SANA);

  const campos: (keyof typeof b & keyof typeof f)[] = [
    'subtotal',
    'total',
    'unidadesValidas',
    'descuento',
    'montoAPagar',
  ];
  const difiere = campos.filter((c) => b[c] !== f[c]);
  if (difiere.length) {
    distintos++;
    if (muestras.length < 5) {
      muestras.push(
        `envío ${envio} · ${items.map((i) => `${i.cantidad}x${i.precioUnitario}`).join(' + ')} → ` +
          difiere
            .map((c) => `${c}: backend ${b[c]} vs carrito ${f[c]}`)
            .join('; '),
      );
    }
  }
}

console.log(`${CARRITOS} carritos al azar comparados.`);
if (distintos) {
  console.log(`✗ ${distintos} dan números distintos:`);
  for (const m of muestras) console.log(`    ${m}`);
  process.exit(1);
}
console.log('✔ el carrito y la IA dan exactamente el mismo monto en todos.');

// El borde que más importa: el carrito NUNCA puede prometer un descuento que
// el chat no vaya a dar. Al revés (quedarse corto) es aceptable, porque el
// envío todavía no se conoce en la web.
let sobrepromesas = 0;
for (let n = 0; n < CARRITOS; n++) {
  const items = Array.from(
    { length: 1 + Math.floor(Math.random() * 5) },
    () => ({
      precioUnitario: PRECIOS[Math.floor(Math.random() * PRECIOS.length)],
      cantidad: 1 + Math.floor(Math.random() * 4),
    }),
  );
  const envio = ENVIOS[Math.floor(Math.random() * ENVIOS.length)];
  // El carrito calcula sin envío; el chat, con el envío real.
  const enLaWeb = frontend(items, 0, REGLAS_HIERBA_SANA).descuento;
  const enElChat = backend(items, envio, REGLAS_HIERBA_SANA).descuento;
  if (enLaWeb > enElChat) {
    sobrepromesas++;
    if (sobrepromesas === 1) {
      console.log(
        `✗ el carrito prometió S/ ${enLaWeb} y el chat da S/ ${enElChat}: ` +
          items.map((i) => `${i.cantidad}x${i.precioUnitario}`).join(' + '),
      );
    }
  }
}
console.log(
  sobrepromesas === 0
    ? '✔ en ningún carrito la web promete más descuento del que da el chat.'
    : `✗ ${sobrepromesas} sobrepromesas.`,
);
process.exit(sobrepromesas === 0 ? 0 : 1);
