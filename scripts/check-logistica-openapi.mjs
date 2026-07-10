/**
 * Drift-check del contrato de Logística.
 *
 * Compara el spec OpenAPI GENERADO desde el código
 * (`openapi/logistica.generated.json`, producido por `npm run openapi:logistica`)
 * contra el CONTRATO PUBLICADO en el portal de developers. Falla (exit 1) si
 * el backend deja de cubrir alguna operación / campo del contrato — es decir,
 * si la implementación derivó del contrato público.
 *
 * Uso:
 *   node scripts/check-logistica-openapi.mjs [ruta-al-contrato.json]
 * Env:
 *   CONTRACT_PATH  ruta alterna al contrato (gana sobre el argumento).
 *
 * Diferencias NO-breaking que se ignoran a propósito:
 *   - `required` extra en respuestas (garantía más estricta del servidor).
 *   - rename cosmético `Error` → `ErrorResponse` (mismo shape).
 *   - operaciones extra del backend fuera del contrato (bulk, legacy deprecado).
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, "..");

const GENERATED = resolve(backendRoot, "openapi/logistica.generated.json");
const DEFAULT_CONTRACT = resolve(
  backendRoot,
  "../../falconext-developers/public/openapi/logistica/2025-07-01.json",
);
const CONTRACT =
  process.env.CONTRACT_PATH || process.argv[2] || DEFAULT_CONTRACT;

function load(label, path) {
  if (!existsSync(path)) {
    console.error(`✗ No se encontró ${label}: ${path}`);
    if (label === "generado")
      console.error("  Corre primero: npm run openapi:logistica");
    process.exit(2);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

const gen = load("generado", GENERATED);
const con = load("contrato", CONTRACT);

const opsOf = (spec) => {
  const out = {};
  for (const p in spec.paths)
    for (const m in spec.paths[p]) {
      const op = spec.paths[p][m];
      if (op && op.operationId) out[op.operationId] = { path: p, method: m };
    }
  return out;
};

const g = opsOf(gen);
const c = opsOf(con);
let breaking = 0;

console.log("== Operaciones del contrato ==");
for (const id of Object.keys(c)) {
  const gg = g[id];
  if (!gg) {
    console.log(`  ✗ FALTA en el generado: ${id} (${c[id].method.toUpperCase()} ${c[id].path})`);
    breaking++;
  } else if (gg.path !== c[id].path || gg.method !== c[id].method) {
    console.log(`  ~ path/method difiere: ${id} → gen ${gg.method} ${gg.path} | contrato ${c[id].method} ${c[id].path}`);
    breaking++;
  } else {
    console.log(`  ✓ ${id.padEnd(22)} ${c[id].method.toUpperCase()} ${c[id].path}`);
  }
}

console.log("\n== Schemas: cobertura de campos ==");
const gs = gen.components?.schemas ?? {};
const cs = con.components?.schemas ?? {};
for (const name of Object.keys(cs)) {
  let gg = gs[name];
  if (!gg && name === "Error" && gs.ErrorResponse) {
    gg = gs.ErrorResponse; // rename cosmético permitido
  }
  if (!gg) {
    console.log(`  ✗ schema faltante: ${name}`);
    breaking++;
    continue;
  }
  const cp = Object.keys(cs[name].properties ?? {});
  const gp = Object.keys(gg.properties ?? {});
  const missing = cp.filter((f) => !gp.includes(f));
  if (missing.length) {
    console.log(`  ✗ ${name}: campos faltantes → ${missing.join(", ")}`);
    breaking++;
  }
}

console.log("\n== Resultado ==");
if (breaking === 0) {
  console.log("  ✅ El backend cubre TODO el contrato (operaciones + campos). Sin drift breaking.");
  process.exit(0);
}
console.log(`  ⚠️  ${breaking} diferencia(s) breaking respecto al contrato. Revisa arriba.`);
process.exit(1);
