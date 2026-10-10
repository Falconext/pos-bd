/**
 * QA de integración: un cliente de principio a fin, atravesando los 6 bloques.
 *
 * Los QA anteriores prueban cada bloque por separado. Lo que esto busca es lo
 * que se rompe EN LAS COSTURAS: que la consulta alimente la lista de espera,
 * que la cotización mueva el embudo y programe el recordatorio, que el
 * voucher bloquee el despacho, que la entrega dispare la reseña y la
 * recompra, y que al final el BI y la ficha 360° cuenten la misma historia.
 *
 * Sin Gemini: se llaman las herramientas directamente, que es lo que el
 * modelo llamaría. Lo que se audita es el sistema, no la redacción.
 *
 *   export DATABASE_URL=postgresql://postgres:developer@localhost:5432/sistema_mype
 *   npx ts-node --transpile-only scripts/qa-recorrido-completo.ts
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { LeadsConsultasService } from '../src/leads/leads-consultas.service';
import { LeadsEmbudoService } from '../src/leads/leads-embudo.service';
import { LeadsBiService } from '../src/leads/leads-bi.service';
import { LeadsDisparadoresService } from '../src/leads/leads-disparadores.service';
import { EtapaCrm } from '../src/leads/leads-embudo';
import { TipoDisparo } from '../src/leads/leads-disparadores';

const TEL = '51900999001';
const ENCARGADO = { id: 1, nombre: 'ROSA (ENCARGADA)' };

let fallos = 0;
let paso = 0;
const ok = (c: boolean, t: string, d = '') => {
  console.log(`${c ? '✔' : '✗'} ${t}${d ? ` — ${d}` : ''}`);
  if (!c) fallos++;
};
const titulo = (t: string) => console.log(`\n── ${++paso}. ${t} ──`);

const enviados: string[] = [];
const whatsappFalso = {
  enviarTexto: async (a: string) => {
    enviados.push(`texto→${a}`);
    return { success: true };
  },
  enviarPlantilla: async (a: string, p: string) => {
    enviados.push(`${p}→${a}`);
    return { success: true };
  },
} as never;
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
  const [{ empresaId }] = await prisma.$queryRaw<{ empresaId: number }[]>`
    SELECT "empresaId" FROM "Comprobante" GROUP BY "empresaId"
    ORDER BY COUNT(*) DESC LIMIT 1`;

  const consultas = new LeadsConsultasService(prisma);
  const embudo = new LeadsEmbudoService(prisma, s3Falso);
  const bi = new LeadsBiService(prisma, consultas);
  const disparos = new LeadsDisparadoresService(prisma, whatsappFalso, embudo);

  // ── Preparación ──
  const producto = await prisma.producto.findFirst({
    where: { empresaId, estado: 'ACTIVO' as never },
    select: { id: true, descripcion: true, disponibilidad: true },
  });
  if (!producto) throw new Error('La empresa de prueba no tiene productos.');
  const comprobante = await prisma.comprobante.findFirst({
    where: { empresaId },
    select: { id: true, serie: true, correlativo: true },
    orderBy: { id: 'desc' },
  });

  const limpiar = async () => {
    await prisma.leadConsulta.deleteMany({ where: { empresaId, telefono: TEL } });
    await prisma.leadDisparo.deleteMany({ where: { empresaId, telefono: TEL } });
    await prisma.leadBajaAvisos.deleteMany({ where: { empresaId, telefono: TEL } });
    await prisma.leadConversacion.deleteMany({
      where: { empresaId, telefonoProspecto: TEL },
    });
  };
  await limpiar();
  await prisma.empresa.update({
    where: { id: empresaId },
    data: {
      iaVentasActiva: true,
      iaVentasConfigJson: {
        disparadores: {
          activos: Object.values(TipoDisparo),
          horaDesde: 0,
          horaHasta: 24,
          topeMarketing: 5,
          topeMarketingDias: 30,
        },
      },
    },
  });

  const conv = await prisma.leadConversacion.create({
    data: { empresaId, telefonoProspecto: TEL, nombreProspecto: 'ROSA QUISPE' },
  });
  const pros = await prisma.leadProspecto.create({
    data: { empresaId, telefonoProspecto: TEL, conversacionId: conv.id },
  });

  // ══ 1. El cliente pregunta por algo que está agotado ══
  titulo('El cliente pregunta por un producto agotado');
  await prisma.producto.update({
    where: { id: producto.id },
    data: { disponibilidad: 'NO_DISPONIBLE' },
  });
  // Lo que hace el processor cuando la búsqueda SÍ encuentra el producto pero
  // está no disponible: lo registra con su disponibilidad real.
  await consultas.registrar(empresaId, conv.id, TEL, [
    {
      texto: 'gastritis cronica',
      hubo: true,
      productoId: producto.id,
      disponibilidad: 'NO_DISPONIBLE',
    },
  ]);
  await embudo.mover(pros.id, empresaId, EtapaCrm.DIAGNOSTICADO, {
    nota: 'Consultó por gastritis',
  });
  const e1 = await prisma.leadProspecto.findUnique({
    where: { id: pros.id },
    select: { etapa: true },
  });
  ok(e1?.etapa === 'DIAGNOSTICADO', 'el embudo avanza a DIAGNOSTICADO');

  // ══ 2. Entra stock: 33.1 debe avisarle ══
  titulo('Entra stock del producto: la lista de espera');
  const sinStock = await disparos.avisarVueltaDeDisponibilidad(empresaId, producto.id);
  ok(
    sinStock.avisados === 0,
    'mientras sigue agotado, no se avisa a nadie (33.7)',
    sinStock.motivo ?? '',
  );

  await prisma.producto.update({
    where: { id: producto.id },
    data: { disponibilidad: 'INMEDIATA' },
  });
  const conStock = await disparos.avisarVueltaDeDisponibilidad(empresaId, producto.id);
  ok(
    conStock.avisados >= 1,
    'al volver el stock, se le programa el aviso (33.1)',
    `${conStock.avisados} aviso(s)`,
  );
  const avisoVuelta = await prisma.leadDisparo.findFirst({
    where: { empresaId, telefono: TEL, tipo: 'VUELTA_DISPONIBILIDAD' },
    select: { referencia: true, estado: true },
  });
  ok(
    avisoVuelta?.referencia === `producto:${producto.id}`,
    'apuntando al producto correcto',
    avisoVuelta?.referencia ?? '',
  );

  // ══ 3. Cotiza: embudo + recordatorio de 3 h ══
  titulo('Cotiza: avanza el embudo y queda el recordatorio de 3 h');
  await embudo.mover(pros.id, empresaId, EtapaCrm.COTIZADO, {
    nota: 'Cotización enviada',
  });
  await disparos.programar({
    empresaId,
    tipo: TipoDisparo.RECUPERAR_COTIZACION,
    telefono: TEL,
    referencia: `conversacion:${conv.id}`,
    conversacionId: conv.id,
  });
  const rec = await prisma.leadDisparo.findFirst({
    where: { empresaId, telefono: TEL, tipo: 'RECUPERAR_COTIZACION' },
    select: { estado: true, programadoPara: true },
  });
  ok(rec?.estado === 'PROGRAMADO', 'el recordatorio queda programado (33.2)');
  const horas =
    (rec!.programadoPara.getTime() - Date.now()) / 3600_000;
  ok(horas > 2.5 && horas < 3.5, 'para dentro de ~3 horas', `${horas.toFixed(1)} h`);

  // ══ 4. Dice "te aviso luego" y después contesta ══
  titulo('Posterga y después contesta: el recordatorio se cancela');
  await disparos.programar({
    empresaId,
    tipo: TipoDisparo.CARRITO_EN_ESPERA,
    telefono: TEL,
    referencia: `conversacion:${conv.id}`,
    conversacionId: conv.id,
  });
  const espera = await prisma.leadDisparo.count({
    where: { empresaId, telefono: TEL, tipo: 'CARRITO_EN_ESPERA', estado: 'PROGRAMADO' },
  });
  ok(espera === 1, 'se programa el recordatorio de la mañana siguiente (33.3)');

  const cancelados = await disparos.cancelar(
    empresaId,
    TEL,
    [TipoDisparo.RECUPERAR_COTIZACION, TipoDisparo.CARRITO_EN_ESPERA],
    'El cliente escribió',
  );
  ok(
    cancelados.cancelados === 2,
    'cuando contesta, los DOS recordatorios se cancelan',
    `${cancelados.cancelados}`,
  );
  const vuelta = await prisma.leadDisparo.count({
    where: { empresaId, telefono: TEL, tipo: 'VUELTA_DISPONIBILIDAD', estado: 'PROGRAMADO' },
  });
  ok(
    vuelta === 1,
    'pero el aviso de "ya hay stock" NO se cancela: sigue siendo noticia',
  );

  // ══ 5. Datos completos y el candado de pago ══
  titulo('Datos completos, voucher y candado de pago');
  await prisma.leadPedidoBorrador.upsert({
    where: { conversacionId: conv.id },
    create: {
      empresaId,
      conversacionId: conv.id,
      zona: 'Provincia',
      tipoZona: 'AGENCIA',
      lugar: 'HUACHO',
      dni: '45678912',
      nombre: 'ROSA QUISPE',
      celular: '987654321',
      costoEnvio: new Prisma.Decimal(10),
      descuentoAplicado: new Prisma.Decimal(10),
      itemsJson: [{ productoId: producto.id, cantidad: 3 }],
      comprobanteId: comprobante?.id ?? null,
      registradoEn: new Date(),
    },
    update: {
      comprobanteId: comprobante?.id ?? null,
      registradoEn: new Date(),
      descuentoAplicado: new Prisma.Decimal(10),
      itemsJson: [{ productoId: producto.id, cantidad: 3 }],
    },
  });
  await embudo.mover(pros.id, empresaId, EtapaCrm.DATOS_COMPLETOS, {});

  // El bot NO puede despachar
  const intentoBot = await embudo.mover(pros.id, empresaId, EtapaCrm.POR_DESPACHAR);
  ok(!intentoBot.movido, 'el bot no puede abrir el despacho');

  // Llega el voucher
  await disparos.registrarBaja(empresaId, '51000000000').catch(() => undefined);
  await embudo.registrarComprobantePago(empresaId, conv.id, {
    mediaId: 'wamid-qa',
    nota: 'ya deposité',
  });
  const e5 = await prisma.leadProspecto.findUnique({
    where: { id: pros.id },
    select: { etapa: true },
  });
  ok(
    e5?.etapa === 'PENDIENTE_VALIDACION_PAGO',
    'el voucher deja el pedido esperando validación',
  );

  let bloqueado = '';
  try {
    await embudo.mover(pros.id, empresaId, EtapaCrm.POR_DESPACHAR, {
      usuario: ENCARGADO,
    });
  } catch (e) {
    bloqueado = (e as Error).message;
  }
  ok(/nadie revisó/i.test(bloqueado), 'ni una persona, con el voucher sin revisar');

  const pago = await prisma.leadComprobantePago.findFirst({
    where: { prospectoId: pros.id },
    select: { id: true },
  });
  await embudo.validarPago(pago!.id, empresaId, ENCARGADO);
  const e6 = await prisma.leadProspecto.findUnique({
    where: { id: pros.id },
    select: { etapa: true },
  });
  ok(e6?.etapa === 'POR_DESPACHAR', 'validado el pago, pasa a despacho');

  // ══ 6. La logística entrega: el embudo sigue y nacen 33.4 y 33.5 ══
  titulo('Se entrega: el embudo sigue a la logística y nacen 33.4 y 33.5');
  if (comprobante) {
    const entregadoEn = new Date(Date.now() - 2 * 3600_000);
    await prisma.envioDespacho.upsert({
      where: { comprobanteId: comprobante.id },
      create: {
        comprobanteId: comprobante.id,
        estado: 'ENTREGADO',
        entregadoEn,
        transportista: 'SHALOM_PRO',
      },
      update: { estado: 'ENTREGADO', entregadoEn },
    });

    await disparos.reconciliarConDespachos();

    const e7 = await prisma.leadProspecto.findUnique({
      where: { id: pros.id },
      select: { etapa: true },
    });
    ok(
      e7?.etapa === 'ENTREGADO',
      'el embudo pasa a ENTREGADO sin que nadie lo toque',
      String(e7?.etapa),
    );

    const resena = await prisma.leadDisparo.findFirst({
      where: { empresaId, telefono: TEL, tipo: 'POST_ENTREGA' },
      select: { programadoPara: true },
    });
    ok(!!resena, 'queda programada la reseña (33.4)');
    if (resena) {
      // Se cuenta desde la entrega real (hace 2 h), no desde ahora: debe
      // quedar a ~22 h, no a 24.
      const h = (resena.programadoPara.getTime() - Date.now()) / 3600_000;
      ok(
        h > 21 && h < 23,
        'contada desde la hora REAL de entrega, no desde ahora',
        `${h.toFixed(1)} h`,
      );
    }

    const recompra = await prisma.leadDisparo.findFirst({
      where: { empresaId, telefono: TEL, tipo: 'RECOMPRA' },
      select: { referencia: true, programadoPara: true },
    });
    ok(
      recompra?.referencia === `producto:${producto.id}`,
      'y la recompra del producto que se llevó (33.5)',
      recompra?.referencia ?? '',
    );
    if (recompra) {
      const d = (recompra.programadoPara.getTime() - Date.now()) / 86400_000;
      ok(d > 24 && d < 26, 'a 25 días', `${d.toFixed(1)} días`);
    }
  }

  // ══ 7. El BI cuenta la historia ══
  titulo('El BI y la ficha 360° cuentan la misma historia');
  const reporte = await bi.resumen(empresaId);
  ok(
    reporte.descuentosOtorgados >= 10,
    'el descuento otorgado figura en el balance',
    `S/ ${reporte.descuentosOtorgados}`,
  );
  ok(
    reporte.malestares.some((m) => m.texto === 'gastritis cronica'),
    'el malestar consultado figura entre los más consultados',
  );
  ok(
    reporte.demografia.ubicacion.provincia >= 1,
    'y el pedido cuenta como provincia',
    JSON.stringify(reporte.demografia.ubicacion),
  );

  const ficha = await bi.historial360(empresaId, TEL);
  ok(!!ficha, 'la ficha 360° del cliente existe');
  ok(
    ficha!.cliente.etapa === 'ENTREGADO',
    'con la etapa final correcta',
    String(ficha!.cliente.etapa),
  );
  ok(
    ficha!.consultasDeSalud.length >= 1,
    'su consulta de salud quedó registrada',
  );
  ok(
    ficha!.historialEtapas.length >= 5,
    'y el rastro completo de por dónde pasó',
    `${ficha!.historialEtapas.length} movimientos`,
  );
  ok(
    ficha!.comprobantesPago.some((p) => p.validadoPor),
    'incluido quién validó su pago',
  );
  ok(
    ficha!.pedidos.length >= 1 && ficha!.resumenCompras.gastado > 0,
    'y su compra con el monto',
    `S/ ${ficha!.resumenCompras.gastado}`,
  );

  // ══ 8. La baja corta todo lo pendiente ══
  titulo('El cliente pide la baja');
  const baja = await disparos.atenderSiEsBaja(empresaId, TEL, 'BAJA');
  ok(baja.eraBaja, 'se reconoce la baja');
  const pendientes = await prisma.leadDisparo.count({
    where: { empresaId, telefono: TEL, estado: 'PROGRAMADO' },
  });
  ok(
    pendientes === 0,
    'y no queda NI UN aviso pendiente para ese número',
    `${pendientes} pendientes`,
  );

  // ── Limpieza ──
  await limpiar();
  if (comprobante) {
    await prisma.envioDespacho.deleteMany({
      where: { comprobanteId: comprobante.id },
    });
  }
  await prisma.producto.update({
    where: { id: producto.id },
    data: { disponibilidad: producto.disponibilidad },
  });
  await prisma.empresa.update({
    where: { id: empresaId },
    data: { iaVentasConfigJson: Prisma.DbNull },
  });

  console.log(
    fallos === 0
      ? '\n✔ RECORRIDO COMPLETO: las costuras entre los 6 bloques funcionan.'
      : `\n✗ RECORRIDO COMPLETO: ${fallos} fallo(s).`,
  );
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
