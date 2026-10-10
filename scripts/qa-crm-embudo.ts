/**
 * E — QA funcional del CRM: embudo, candado de pago, BI y 360°.
 *
 * Contra Postgres de verdad, porque lo que puede salir mal son las consultas:
 * que el candado se salte por un camino que los tests unitarios no cubren,
 * que el BI cuente dos veces, que el 360° una a dos clientes distintos.
 *
 *   export DATABASE_URL=postgresql://postgres:developer@localhost:5432/sistema_mype
 *   npx ts-node --transpile-only scripts/qa-crm-embudo.ts
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { LeadsEmbudoService } from '../src/leads/leads-embudo.service';
import { LeadsConsultasService } from '../src/leads/leads-consultas.service';
import { LeadsBiService } from '../src/leads/leads-bi.service';
import { EtapaCrm } from '../src/leads/leads-embudo';

const EMPRESA_ID = 89;
const TEL_A = '51900000111';
const TEL_B = '51900000222';
const DNI = '44556677';

let fallos = 0;
const ok = (c: boolean, t: string, d = '') => {
  console.log(`${c ? '✔' : '✗'} ${t}${d ? ` — ${d}` : ''}`);
  if (!c) fallos++;
};
const ENCARGADO = { id: 1, nombre: 'ROSA (ENCARGADA)' };

const s3Falso = {
  isEnabled: () => false,
  generateComprobantePagoLeadKey: () => 'k',
  uploadImage: async () => 'u',
} as never;

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL no apunta a localhost. QA solo en local.');
  }
  const prisma = new PrismaService();
  const embudo = new LeadsEmbudoService(prisma, s3Falso);
  const consultas = new LeadsConsultasService(prisma);
  const bi = new LeadsBiService(prisma, consultas);

  // ── Limpiar y preparar dos clientes con el MISMO DNI ──
  for (const tel of [TEL_A, TEL_B]) {
    await prisma.leadConsulta.deleteMany({ where: { empresaId: EMPRESA_ID, telefono: tel } });
    await prisma.leadConversacion.deleteMany({
      where: { empresaId: EMPRESA_ID, telefonoProspecto: tel },
    });
  }

  const crear = async (telefono: string, nombre: string) => {
    const conv = await prisma.leadConversacion.create({
      data: { empresaId: EMPRESA_ID, telefonoProspecto: telefono, nombreProspecto: nombre },
    });
    const pros = await prisma.leadProspecto.create({
      data: {
        empresaId: EMPRESA_ID,
        telefonoProspecto: telefono,
        nombreProspecto: nombre,
        conversacionId: conv.id,
        sexo: telefono === TEL_A ? 'F' : 'M',
        edad: telefono === TEL_A ? 52 : 34,
      },
    });
    return { conv, pros };
  };

  const a = await crear(TEL_A, 'ROSA QUISPE HUAMAN');
  const b = await crear(TEL_B, 'ROSA QUISPE H.');

  // ── 1. Nace en NUEVO ──
  ok(a.pros.etapa === 'NUEVO', 'un prospecto nuevo arranca en NUEVO', String(a.pros.etapa));

  // ── 2. El candado: el bot NO puede abrir el despacho ──
  await embudo.mover(a.pros.id, EMPRESA_ID, EtapaCrm.DATOS_COMPLETOS, {
    nota: 'datos listos',
  });
  const intentoBot = await embudo.mover(a.pros.id, EMPRESA_ID, EtapaCrm.POR_DESPACHAR);
  ok(
    intentoBot.movido === false && /solo una persona/i.test(intentoBot.motivo ?? ''),
    'el bot no puede pasar a POR_DESPACHAR',
    intentoBot.motivo ?? '',
  );
  const trasBot = await prisma.leadProspecto.findUnique({
    where: { id: a.pros.id },
    select: { etapa: true },
  });
  ok(trasBot?.etapa === 'DATOS_COMPLETOS', 'y la etapa no se movió', String(trasBot?.etapa));

  // ── 3. Una persona sí ──
  const porPersona = await embudo.mover(a.pros.id, EMPRESA_ID, EtapaCrm.POR_DESPACHAR, {
    usuario: ENCARGADO,
  });
  ok(porPersona.movido === true, 'una persona sí puede');
  const hist = await embudo.historial(a.pros.id, EMPRESA_ID);
  ok(
    hist.some((h) => h.hacia === 'POR_DESPACHAR' && h.actor === ENCARGADO.nombre),
    'y queda registrado QUIÉN lo movió',
    hist.map((h) => `${h.hacia}:${h.actor}`).join(' '),
  );

  // ── 4. Con un voucher sin revisar NO se despacha ──
  await embudo.mover(b.pros.id, EMPRESA_ID, EtapaCrm.DATOS_COMPLETOS, {});
  await embudo.registrarComprobantePago(EMPRESA_ID, b.conv.id, {
    mediaId: 'wamid-falso',
    nota: 'ya transferí',
  });
  const trasVoucher = await prisma.leadProspecto.findUnique({
    where: { id: b.pros.id },
    select: { etapa: true },
  });
  ok(
    trasVoucher?.etapa === 'PENDIENTE_VALIDACION_PAGO',
    'el voucher del cliente deja el pedido esperando validación',
    String(trasVoucher?.etapa),
  );

  let bloqueado = '';
  try {
    await embudo.mover(b.pros.id, EMPRESA_ID, EtapaCrm.POR_DESPACHAR, {
      usuario: ENCARGADO,
    });
  } catch (e) {
    bloqueado = (e as Error).message;
  }
  ok(
    /nadie revisó/i.test(bloqueado),
    'ni una persona puede despachar con el voucher sin revisar',
    bloqueado,
  );

  // ── 5. Validar el pago sí abre el despacho ──
  const pago = await prisma.leadComprobantePago.findFirst({
    where: { prospectoId: b.pros.id },
    select: { id: true },
  });
  await embudo.validarPago(pago!.id, EMPRESA_ID, ENCARGADO);
  const trasValidar = await prisma.leadProspecto.findUnique({
    where: { id: b.pros.id },
    select: { etapa: true },
  });
  ok(trasValidar?.etapa === 'POR_DESPACHAR', 'validado el pago, pasa a despacho');
  const pagoFinal = await prisma.leadComprobantePago.findUnique({
    where: { id: pago!.id },
    select: { validadoPor: true, validadoEn: true },
  });
  ok(
    pagoFinal?.validadoPor === ENCARGADO.nombre && !!pagoFinal?.validadoEn,
    'y queda quién validó el pago',
    String(pagoFinal?.validadoPor),
  );

  // ── 6. Rechazar sin motivo no se permite ──
  let sinMotivo = '';
  try {
    await embudo.rechazarPago(pago!.id, EMPRESA_ID, ENCARGADO, '   ');
  } catch (e) {
    sinMotivo = (e as Error).message;
  }
  ok(/indica por qué/i.test(sinMotivo), 'un rechazo exige motivo', sinMotivo);

  // ── 7. El tablero trae las 12 columnas siempre ──
  const tablero = await embudo.tablero(EMPRESA_ID);
  ok(tablero.columnas.length === 12, 'el tablero tiene las 12 columnas', `${tablero.columnas.length}`);
  ok(
    tablero.columnas.every((c) => Array.isArray(c.pedidos)),
    'todas con su lista, incluso vacías',
  );

  // ── 8. Consultas: productos, malestares y no habidos ──
  await consultas.registrar(EMPRESA_ID, a.conv.id, TEL_A, [
    { texto: 'moringa', hubo: true, disponibilidad: 'INMEDIATA' },
    { texto: 'moringa', hubo: true, disponibilidad: 'INMEDIATA' },
    { texto: 'dolor de rodillas', hubo: true },
    { texto: 'naturplus 3000', hubo: false },
  ]);
  await consultas.registrar(EMPRESA_ID, b.conv.id, TEL_B, [
    { texto: 'naturplus 3000', hubo: false },
    { texto: 'gastritis cronica', hubo: true },
  ]);

  const prods = await bi.productosConsultados(EMPRESA_ID);
  ok(
    prods.disponibles[0]?.texto === 'moringa' && prods.disponibles[0]?.veces === 2,
    'el producto más consultado se cuenta bien',
    JSON.stringify(prods.disponibles[0]),
  );
  ok(
    prods.noHabidos.some((n) => n.texto === 'naturplus 3000' && n.veces === 2),
    'los "no habidos" se agrupan: 2 personas pidieron lo mismo',
    JSON.stringify(prods.noHabidos),
  );

  const mal = await bi.malestaresConsultados(EMPRESA_ID);
  const textos = mal.map((m) => m.texto);
  ok(
    textos.includes('dolor de rodillas') && textos.includes('gastritis cronica'),
    'los malestares se clasifican aparte de los productos',
    textos.join(' | '),
  );
  ok(
    !textos.includes('moringa') && !textos.includes('naturplus 3000'),
    'y un nombre de producto no se cuenta como malestar',
  );

  // ── 9. Demografía ──
  const demo = await bi.demografia(EMPRESA_ID);
  ok(
    demo.sexo.mujeres >= 1 && demo.sexo.hombres >= 1,
    'cuenta hombres y mujeres de los que lo dijeron',
    JSON.stringify(demo.sexo),
  );
  ok(
    demo.edades.some((e) => e.etiqueta === '45-59' && e.total >= 1) &&
      demo.edades.some((e) => e.etiqueta === '30-44' && e.total >= 1),
    'y los reparte por tramo de edad',
    JSON.stringify(demo.edades),
  );
  ok(
    demo.edades.some((e) => e.etiqueta === 'sin dato'),
    'con un tramo explícito de "sin dato", en vez de adivinar',
  );

  // ── 10. 360°: dos números del mismo DNI se unen ──
  for (const [conv, tel] of [[a.conv.id, TEL_A], [b.conv.id, TEL_B]] as [number, string][]) {
    await prisma.leadPedidoBorrador.upsert({
      where: { conversacionId: conv },
      create: { empresaId: EMPRESA_ID, conversacionId: conv, dni: DNI, zona: 'Lima', lugar: 'SJL', tipoZona: 'DOMICILIO' },
      update: { dni: DNI },
    });
  }
  const ficha = await bi.historial360(EMPRESA_ID, TEL_A);
  ok(!!ficha, 'la ficha 360° se encuentra por teléfono');
  ok(
    ficha!.cliente.telefonos.length === 2 && ficha!.cliente.unidoPorDni === true,
    'los dos números del mismo DNI se ven como un solo cliente',
    JSON.stringify(ficha!.cliente.telefonos),
  );
  ok(
    ficha!.consultasDeSalud.length >= 2,
    'y el historial de salud suma los dos números',
    `${ficha!.consultasDeSalud.length} consultas`,
  );
  ok(
    ficha!.noHabidos.length >= 2,
    'igual que los productos que pidió y no había',
    `${ficha!.noHabidos.length}`,
  );
  ok(
    ficha!.historialEtapas.length >= 1,
    'trae por dónde pasó el pedido',
    `${ficha!.historialEtapas.length} movimientos`,
  );

  // ── 11. Sin DNI NO se unen: dos clientes distintos no comparten historial ──
  await prisma.leadPedidoBorrador.updateMany({
    where: { conversacionId: b.conv.id },
    data: { dni: '11112222' },
  });
  const separada = await bi.historial360(EMPRESA_ID, TEL_A);
  ok(
    separada!.cliente.telefonos.length === 1,
    'con DNI distinto quedan separados',
    JSON.stringify(separada!.cliente.telefonos),
  );

  // ── 12. Nombre parecido: se SUGIERE, no se une ──
  const sugerencias = await bi.sugerenciasDeUnion(EMPRESA_ID, TEL_A);
  ok(
    sugerencias.some((s) => s.telefono === TEL_B),
    'un nombre parecido aparece como sugerencia para que decida una persona',
    JSON.stringify(sugerencias.map((s) => `${s.nombre}:${Number(s.parecido).toFixed(2)}`)),
  );

  // ── Limpiar ──
  await prisma.leadConsulta.deleteMany({
    where: { empresaId: EMPRESA_ID, telefono: { in: [TEL_A, TEL_B] } },
  });
  await prisma.leadConversacion.deleteMany({
    where: { empresaId: EMPRESA_ID, telefonoProspecto: { in: [TEL_A, TEL_B] } },
  });

  console.log(fallos === 0 ? '\nQA E: todo OK.' : `\nQA E: ${fallos} fallo(s).`);
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
