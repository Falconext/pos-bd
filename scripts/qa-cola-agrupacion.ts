/**
 * QA de la agrupación de mensajes contra Redis de verdad (A2).
 *
 * Los tests unitarios comprueban que mandamos el mismo `jobId`; esto comprueba
 * lo que de verdad importa: que BullMQ descarte el duplicado mientras hay uno
 * esperando, y que el id se libere al terminar. Si el id NO se liberara, esa
 * conversación no volvería a recibir respuesta nunca más.
 *
 *   npx ts-node --transpile-only scripts/qa-cola-agrupacion.ts
 */
import { Queue, Worker } from 'bullmq';
import { redisConnection, JOB_RESPONDER } from '../src/leads/leads.constants';

const COLA = 'qa-agrupacion-' + Date.now();
const JOB_ID = 'resp-89-42';

const opciones = {
  jobId: JOB_ID,
  delay: 1500,
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
};

let fallos = 0;
function comprobar(ok: boolean, texto: string) {
  console.log(`${ok ? '✔' : '✗'} ${texto}`);
  if (!ok) fallos++;
}

async function main() {
  const conexion = redisConnection();
  const cola = new Queue(COLA, { connection: conexion });

  // 1) Tres mensajes seguidos → un solo trabajo en espera.
  for (let i = 0; i < 3; i++) {
    await cola.add(
      JOB_RESPONDER,
      { empresaId: 89, conversacionId: 42 },
      opciones,
    );
  }
  const esperando = await cola.getDelayedCount();
  comprobar(
    esperando === 1,
    `tres mensajes seguidos dejan ${esperando} trabajo(s) en espera (se espera 1)`,
  );

  // 2) Se procesa: debe correr una sola vez.
  let ejecuciones = 0;
  const worker = new Worker(
    COLA,
    async () => {
      ejecuciones++;
    },
    { connection: conexion },
  );
  await new Promise((r) => worker.on('completed', r));
  comprobar(
    ejecuciones === 1,
    `se ejecutó ${ejecuciones} vez/veces (se espera 1)`,
  );

  // 3) El id quedó libre: un mensaje posterior sí programa otra respuesta.
  await new Promise((r) => setTimeout(r, 300));
  await cola.add(
    JOB_RESPONDER,
    { empresaId: 89, conversacionId: 42 },
    opciones,
  );
  const despues = await cola.getDelayedCount();
  comprobar(
    despues === 1,
    `tras completarse, un mensaje nuevo vuelve a programar respuesta (${despues})`,
  );

  // 4) Lo mismo cuando el trabajo FALLA: el id no puede quedarse retenido.
  await worker.close();
  await cola.obliterate({ force: true });
  await cola.add(JOB_RESPONDER, {}, { ...opciones, delay: 0 });
  const workerQueFalla = new Worker(
    COLA,
    () => {
      throw new Error('fallo simulado');
    },
    { connection: conexion },
  );
  await new Promise((r) => workerQueFalla.on('failed', r));
  await new Promise((r) => setTimeout(r, 300));
  await workerQueFalla.close();
  await cola.add(JOB_RESPONDER, {}, opciones);
  const trasFallo = await cola.getDelayedCount();
  comprobar(
    trasFallo === 1,
    `tras un fallo, la conversación sigue pudiendo recibir respuesta (${trasFallo})`,
  );

  await cola.obliterate({ force: true });
  await cola.close();
  console.log(
    fallos === 0
      ? '\nTodo correcto.'
      : `\n${fallos} comprobación(es) fallida(s).`,
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
