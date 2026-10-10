/**
 * F — QA funcional del motor de disparadores, contra Postgres de verdad.
 *
 * Lo que se prueba acá no es el texto de los avisos: es que el motor NO mande
 * lo que no debe. Un disparador que manda de más hunde la cuenta de WhatsApp
 * del negocio, y eso no se recupera con un deploy.
 *
 * El WhatsApp es de mentira a propósito: se registra a quién se le habría
 * escrito, sin escribirle a nadie.
 *
 *   export DATABASE_URL=postgresql://postgres:developer@localhost:5432/sistema_mype
 *   npx ts-node --transpile-only scripts/qa-disparadores.ts
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { LeadsDisparadoresService } from '../src/leads/leads-disparadores.service';
import { LeadsEmbudoService } from '../src/leads/leads-embudo.service';
import { TipoDisparo } from '../src/leads/leads-disparadores';

const TEL = '51900555001';
const TEL2 = '51900555002';

let fallos = 0;
const ok = (c: boolean, t: string, d = '') => {
  console.log(`${c ? '✔' : '✗'} ${t}${d ? ` — ${d}` : ''}`);
  if (!c) fallos++;
};

/** WhatsApp de mentira: anota a quién se le habría escrito. */
const enviados: { tipo: string; a: string; plantilla?: string }[] = [];
const whatsappFalso = {
  enviarTexto: async (a: string, texto: string) => {
    enviados.push({ tipo: 'texto', a });
    return { success: true, mensajeId: `t-${enviados.length}` };
  },
  enviarPlantilla: async (a: string, plantilla: string) => {
    enviados.push({ tipo: 'plantilla', a, plantilla });
    return { success: true, mensajeId: `p-${enviados.length}` };
  },
} as never;

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL no apunta a localhost. QA solo en local.');
  }
  const prisma = new PrismaService();

  const [{ empresaId }] = await prisma.$queryRaw<{ empresaId: number }[]>`
    SELECT "empresaId" FROM "Comprobante" GROUP BY "empresaId"
    ORDER BY COUNT(*) DESC LIMIT 1`;
  console.log(`Empresa de prueba: ${empresaId}\n`);

  const embudo = new LeadsEmbudoService(prisma, { isEnabled: () => false } as never);
  const srv = new LeadsDisparadoresService(prisma, whatsappFalso, embudo);

  // ── Limpiar ──
  const limpiar = async () => {
    await prisma.leadDisparo.deleteMany({
      where: { empresaId, telefono: { in: [TEL, TEL2] } },
    });
    await prisma.leadBajaAvisos.deleteMany({
      where: { empresaId, telefono: { in: [TEL, TEL2] } },
    });
    await prisma.leadConversacion.deleteMany({
      where: { empresaId, telefonoProspecto: { in: [TEL, TEL2] } },
    });
  };
  await limpiar();

  // Dos clientes, con la IA activa y los disparadores todos encendidos
  await prisma.empresa.update({
    where: { id: empresaId },
    data: {
      iaVentasConfigJson: {
        disparadores: {
          activos: Object.values(TipoDisparo),
          horaDesde: 0,
          horaHasta: 24,
          topeMarketing: 2,
          topeMarketingDias: 30,
        },
      },
    },
  });

  const crear = async (telefono: string) => {
    const conv = await prisma.leadConversacion.create({
      data: { empresaId, telefonoProspecto: telefono, nombreProspecto: 'ROSA QA' },
    });
    const pros = await prisma.leadProspecto.create({
      data: {
        empresaId,
        telefonoProspecto: telefono,
        conversacionId: conv.id,
      },
    });
    return { conv, pros };
  };
  /** Deja la config con los disparadores indicados y sin restricción de hora. */
  const configurar = async (activos: TipoDisparo[], topeMarketing = 2) => {
    await prisma.empresa.update({
      where: { id: empresaId },
      data: {
        iaVentasConfigJson: {
          disparadores: {
            activos,
            horaDesde: 0,
            horaHasta: 24,
            topeMarketing,
            topeMarketingDias: 30,
          },
        },
      },
    });
  };

  const a = await crear(TEL);
  const b = await crear(TEL2);

  // ── 1. Idempotencia ──
  const r1 = await srv.programar({
    empresaId,
    tipo: TipoDisparo.RECUPERAR_COTIZACION,
    telefono: TEL,
    referencia: `conversacion:${a.conv.id}`,
    conversacionId: a.conv.id,
  });
  const r2 = await srv.programar({
    empresaId,
    tipo: TipoDisparo.RECUPERAR_COTIZACION,
    telefono: TEL,
    referencia: `conversacion:${a.conv.id}`,
    conversacionId: a.conv.id,
  });
  const cuantos = await prisma.leadDisparo.count({
    where: { empresaId, telefono: TEL, tipo: 'RECUPERAR_COTIZACION' },
  });
  ok(
    r1.programado && r2.programado && cuantos === 1,
    'programar dos veces el mismo hecho deja UN solo aviso',
    `filas=${cuantos}`,
  );

  // ── 2. Un disparador apagado no se programa ──
  await prisma.empresa.update({
    where: { id: empresaId },
    data: {
      iaVentasConfigJson: {
        disparadores: {
          activos: [TipoDisparo.RECUPERAR_COTIZACION, TipoDisparo.RECOMPRA, TipoDisparo.POST_ENTREGA],
          horaDesde: 0,
          horaHasta: 24,
          topeMarketing: 2,
          topeMarketingDias: 30,
        },
      },
    },
  });
  const apagado = await srv.programar({
    empresaId,
    tipo: TipoDisparo.REACTIVACION,
    telefono: TEL,
    referencia: 'inactivo:2026-09',
  });
  ok(
    !apagado.programado && /apagado/.test(apagado.motivo ?? ''),
    'un disparador que el negocio apagó no se programa',
    apagado.motivo ?? '',
  );

  // ── 3. Enviar: con la ventana cerrada va por plantilla ──
  const disparo = await prisma.leadDisparo.findFirst({
    where: { empresaId, telefono: TEL, tipo: 'RECUPERAR_COTIZACION' },
    select: { id: true },
  });
  await prisma.leadDisparo.update({
    where: { id: disparo!.id },
    data: { programadoPara: new Date(Date.now() - 60_000) },
  });
  enviados.length = 0;
  const env = await srv.procesarUno(disparo!.id);
  ok(
    env.enviado && env.via === 'plantilla',
    'sin mensajes del cliente (ventana cerrada) se manda PLANTILLA',
    `via=${env.via}`,
  );
  ok(
    enviados[0]?.plantilla === 'recuperar_cotizacion',
    'y es la plantilla que corresponde al disparador',
    enviados[0]?.plantilla ?? '',
  );

  // ── 4. No se manda dos veces ──
  const repetido = await srv.procesarUno(disparo!.id);
  ok(
    !repetido.enviado,
    'un aviso ya enviado no se vuelve a mandar',
    repetido.motivo ?? '',
  );

  // ── 5. Con la ventana abierta va texto libre (y es gratis) ──
  await prisma.leadMensaje.create({
    data: { conversacionId: b.conv.id, rol: 'USUARIO', contenido: 'hola' },
  });
  await srv.programar({
    empresaId,
    tipo: TipoDisparo.RECUPERAR_COTIZACION,
    telefono: TEL2,
    referencia: `conversacion:${b.conv.id}`,
    conversacionId: b.conv.id,
  });
  const d2 = await prisma.leadDisparo.findFirst({
    where: { empresaId, telefono: TEL2 },
    select: { id: true },
  });
  await prisma.leadDisparo.update({
    where: { id: d2!.id },
    data: { programadoPara: new Date(Date.now() - 60_000) },
  });
  enviados.length = 0;
  const env2 = await srv.procesarUno(d2!.id);
  ok(
    env2.enviado && env2.via === 'texto',
    'con la ventana de 24 h abierta se manda texto, no plantilla',
    `via=${env2.via}`,
  );

  // ── 6. La baja corta todo ──
  await srv.programar({
    empresaId,
    tipo: TipoDisparo.RECOMPRA,
    telefono: TEL,
    referencia: 'producto:999999',
  });
  const baja = await srv.registrarBaja(empresaId, TEL, 'BAJA');
  ok(baja.cancelados >= 1, 'la baja cancela lo que estaba pendiente', `${baja.cancelados}`);
  ok(await srv.estaDeBaja(empresaId, TEL), 'y el número queda registrado de baja');

  // Un aviso nuevo a un número de baja se omite al enviar
  await prisma.leadDisparo.create({
    data: {
      empresaId,
      tipo: 'POST_ENTREGA',
      telefono: TEL,
      referencia: 'comprobante:1',
      programadoPara: new Date(Date.now() - 60_000),
    },
  });
  const trasBaja = await prisma.leadDisparo.findFirst({
    where: { empresaId, telefono: TEL, tipo: 'POST_ENTREGA' },
    select: { id: true },
  });
  enviados.length = 0;
  const envBaja = await srv.procesarUno(trasBaja!.id);
  ok(
    !envBaja.enviado && /no recibir más avisos/i.test(envBaja.motivo ?? ''),
    'a un número de baja no se le escribe, ni los transaccionales',
    envBaja.motivo ?? '',
  );
  ok(enviados.length === 0, 'y de verdad no se mandó nada');

  // ── 7. "BAJA" detectada en un mensaje entrante ──
  await prisma.leadBajaAvisos.deleteMany({ where: { empresaId, telefono: TEL } });
  const noEraBaja = await srv.atenderSiEsBaja(empresaId, TEL, 'me das de baja el precio?');
  ok(!noEraBaja.eraBaja, '"me das de baja el precio" NO es una baja');
  const siEraBaja = await srv.atenderSiEsBaja(empresaId, TEL, 'BAJA');
  ok(siEraBaja.eraBaja, 'pero "BAJA" sola sí');

  // ── 8. 33.7: nunca sobre un producto que no hay ──
  const productoNo = await prisma.producto.findFirst({
    where: { empresaId },
    select: { id: true, disponibilidad: true, stock: true },
  });
  if (productoNo) {
    await prisma.producto.update({
      where: { id: productoNo.id },
      data: { disponibilidad: 'NO_DISPONIBLE' },
    });
    await prisma.leadBajaAvisos.deleteMany({ where: { empresaId, telefono: TEL2 } });
    await prisma.leadDisparo.create({
      data: {
        empresaId,
        tipo: 'RECOMPRA',
        telefono: TEL2,
        referencia: `producto:${productoNo.id}`,
        programadoPara: new Date(Date.now() - 60_000),
      },
    });
    const dNo = await prisma.leadDisparo.findFirst({
      where: { empresaId, telefono: TEL2, tipo: 'RECOMPRA' },
      select: { id: true },
    });
    enviados.length = 0;
    const envNo = await srv.procesarUno(dNo!.id);
    ok(
      !envNo.enviado && /ya no está disponible/i.test(envNo.motivo ?? ''),
      '33.7: no se avisa la recompra de algo que ya no hay',
      envNo.motivo ?? '',
    );
    const estado = await prisma.leadDisparo.findUnique({
      where: { id: dNo!.id },
      select: { estado: true, motivo: true },
    });
    ok(
      estado?.estado === 'OMITIDO',
      'y queda OMITIDO con el motivo escrito, no perdido',
      `${estado?.estado}`,
    );
    await prisma.producto.update({
      where: { id: productoNo.id },
      data: { disponibilidad: productoNo.disponibilidad },
    });
  }

  // ── 9. El tope de marketing ──
  // Con un producto que SÍ existe y está disponible: si no, salta antes la
  // regla 33.7 y no se estaría midiendo el tope.
  await configurar(Object.values(TipoDisparo));
  await prisma.leadDisparo.deleteMany({ where: { empresaId, telefono: TEL2 } });
  const productoVivo = await prisma.producto.findFirst({
    where: { empresaId, OR: [{ disponibilidad: 'INMEDIATA' }, { stock: { gt: 0 } }] },
    select: { id: true },
  });
  if (!productoVivo) throw new Error('La empresa de prueba no tiene productos disponibles.');
  // Dos marketing ya enviados en el mes
  for (const ref of ['producto:111', 'producto:222']) {
    await prisma.leadDisparo.create({
      data: {
        empresaId,
        tipo: 'RECOMPRA',
        telefono: TEL2,
        referencia: ref,
        programadoPara: new Date(),
        estado: 'ENVIADO',
        enviadoEn: new Date(),
      },
    });
  }
  await prisma.leadDisparo.create({
    data: {
      empresaId,
      tipo: 'RECOMPRA',
      telefono: TEL2,
      referencia: `producto:${productoVivo.id}`,
      programadoPara: new Date(Date.now() - 60_000),
    },
  });
  const tercero = await prisma.leadDisparo.findFirst({
    where: { empresaId, telefono: TEL2, referencia: `producto:${productoVivo.id}` },
    select: { id: true },
  });
  const envTope = await srv.procesarUno(tercero!.id);
  ok(
    !envTope.enviado && /avisos comerciales/i.test(envTope.motivo ?? ''),
    'el tercer aviso comercial del mes no sale',
    envTope.motivo ?? '',
  );

  // ── 10. Pero un transaccional sí, con el tope lleno ──
  await prisma.leadDisparo.create({
    data: {
      empresaId,
      tipo: 'POST_ENTREGA',
      telefono: TEL2,
      referencia: 'comprobante:777',
      programadoPara: new Date(Date.now() - 60_000),
    },
  });
  const trans = await prisma.leadDisparo.findFirst({
    where: { empresaId, telefono: TEL2, tipo: 'POST_ENTREGA' },
    select: { id: true },
  });
  const envTrans = await srv.procesarUno(trans!.id);
  ok(
    envTrans.enviado,
    'avisarle que su pedido llegó no cuenta para el tope: no es publicidad',
    envTrans.motivo ?? '',
  );

  // ── 11. Con una persona atendiendo, espera ──
  await prisma.leadProspecto.update({
    where: { id: b.pros.id },
    data: { botActivo: false, pausadoHasta: new Date(Date.now() + 3600_000) },
  });
  await prisma.leadDisparo.create({
    data: {
      empresaId,
      tipo: 'CARRITO_EN_ESPERA',
      telefono: TEL2,
      referencia: `conversacion:${b.conv.id}`,
      programadoPara: new Date(Date.now() - 60_000),
    },
  });
  const pausado = await prisma.leadDisparo.findFirst({
    where: { empresaId, telefono: TEL2, tipo: 'CARRITO_EN_ESPERA' },
    select: { id: true },
  });
  const envPausa = await srv.procesarUno(pausado!.id);
  const trasPausa = await prisma.leadDisparo.findUnique({
    where: { id: pausado!.id },
    select: { estado: true, programadoPara: true },
  });
  ok(
    !envPausa.enviado && /atendiendo/i.test(envPausa.motivo ?? ''),
    'con un asesor atendiendo el aviso no sale',
    envPausa.motivo ?? '',
  );
  ok(
    trasPausa?.estado === 'PROGRAMADO' && trasPausa.programadoPara > new Date(),
    'y NO se descarta: queda reprogramado para más tarde',
    `${trasPausa?.estado} ${trasPausa?.programadoPara.toISOString()}`,
  );

  // ── 12. Cancelar cuando el cliente escribe ──
  await prisma.leadProspecto.update({
    where: { id: b.pros.id },
    data: { botActivo: true, pausadoHasta: null },
  });
  const cancelados = await srv.cancelar(
    empresaId,
    TEL2,
    [TipoDisparo.CARRITO_EN_ESPERA, TipoDisparo.RECUPERAR_COTIZACION],
    'El cliente escribió',
  );
  ok(
    cancelados.cancelados >= 1,
    'cuando el cliente contesta, los recordatorios pendientes se cancelan',
    `${cancelados.cancelados}`,
  );

  // ── 13. El listado del panel ──
  const panel = await srv.listar(empresaId);
  ok(
    Array.isArray(panel.disparos) && Array.isArray(panel.porEstado),
    'el panel puede listar lo programado y lo enviado',
  );
  ok(
    panel.porEstado.some((p) => p.estado === 'OMITIDO' || p.estado === 'ENVIADO'),
    'con el conteo por estado, para ver qué no salió y por qué',
    JSON.stringify(panel.porEstado),
  );

  await limpiar();
  // `undefined` en Prisma significa "no toques este campo": la config de
  // prueba quedaba puesta en la empresa. Con null se borra de verdad.
  await prisma.empresa.update({
    where: { id: empresaId },
    // Prisma pide el centinela para poner un Json en NULL; `undefined`
    // significaría "no toques este campo" y la config de prueba quedaría.
    data: { iaVentasConfigJson: Prisma.DbNull },
  });

  console.log(fallos === 0 ? '\nQA F: todo OK.' : `\nQA F: ${fallos} fallo(s).`);
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
