/**
 * La costura con Shalom: ¿lo que escribe su scheduler mueve el CRM?
 *
 * No prueba la API de Shalom (para eso hacen falta credenciales y una guía
 * real). Prueba lo que de verdad podía estar roto: que cuando el scheduler de
 * Shalom marca un envío como entregado, el embudo avance y nazcan los avisos
 * de postventa.
 *
 * El punto delicado: el scheduler NO escribe en la base directamente, llama a
 * `EnvioDespachoService.update`, que es justo el método que modifiqué para
 * sellar `entregadoEn`. Si ese sellado no ocurriera por ese camino, la reseña
 * de 33.4 se contaría desde que el cron se enteró y no desde la entrega.
 *
 *   npx ts-node --transpile-only scripts/qa-costura-shalom.ts
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { EnvioDespachoService } from '../src/envio-despacho/envio-despacho.service';
import { EstadoDespacho } from '../src/envio-despacho/dto/envio-despacho.dto';
import { LeadsEmbudoService } from '../src/leads/leads-embudo.service';
import { LeadsDisparadoresService } from '../src/leads/leads-disparadores.service';
import { TipoDisparo } from '../src/leads/leads-disparadores';
import { Prisma } from '@prisma/client';

const TEL = '51900888001';

let fallos = 0;
const ok = (c: boolean, t: string, d = '') => {
  console.log(`${c ? '✔' : '✗'} ${t}${d ? ` — ${d}` : ''}`);
  if (!c) fallos++;
};

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL no apunta a localhost. QA solo en local.');
  }
  const prisma = new PrismaService();
  const [{ empresaId }] = await prisma.$queryRaw<{ empresaId: number }[]>`
    SELECT "empresaId" FROM "Comprobante" GROUP BY "empresaId"
    ORDER BY COUNT(*) DESC LIMIT 1`;

  // Lo que el scheduler de Shalom le inyecta al servicio de despacho.
  const avisos: string[] = [];
  const despachos = new EnvioDespachoService(
    prisma,
    { resolveForEmpresa: async () => undefined } as never,
    {
      enviarTexto: async () => {
        avisos.push('wa');
        return { success: true };
      },
      enviarPlantilla: async () => {
        avisos.push('plantilla');
        return { success: true };
      },
    } as never,
  );
  const embudo = new LeadsEmbudoService(prisma, { isEnabled: () => false } as never);
  const disparos = new LeadsDisparadoresService(
    prisma,
    { enviarTexto: async () => ({ success: true }), enviarPlantilla: async () => ({ success: true }) } as never,
    embudo,
  );

  const comprobante = await prisma.comprobante.findFirst({
    where: { empresaId },
    select: { id: true, clienteId: true },
    orderBy: { id: 'desc' },
  });
  if (!comprobante) throw new Error('Sin comprobantes para la prueba.');
  const producto = await prisma.producto.findFirst({
    where: { empresaId, OR: [{ disponibilidad: 'INMEDIATA' }, { stock: { gt: 0 } }] },
    select: { id: true },
  });

  const limpiar = async () => {
    await prisma.leadDisparo.deleteMany({ where: { empresaId, telefono: TEL } });
    await prisma.leadConversacion.deleteMany({
      where: { empresaId, telefonoProspecto: TEL },
    });
    await prisma.envioDespacho.deleteMany({
      where: { comprobanteId: comprobante.id },
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

  // El aviso de "entregado" sale del teléfono de la FICHA del cliente, no del
  // celular del destinatario del envío (`if (!telefono) return` en
  // notificarCambioEstado). En el flujo real la IA lo captura y `update()` lo
  // copia a la ficha; acá se pone a mano y se restaura al final.
  const cliente = await prisma.cliente.findUnique({
    where: { id: comprobante.clienteId },
    select: { telefono: true },
  });
  await prisma.cliente.update({
    where: { id: comprobante.clienteId },
    data: { telefono: TEL },
  });

  const conv = await prisma.leadConversacion.create({
    data: { empresaId, telefonoProspecto: TEL, nombreProspecto: 'ROSA SHALOM' },
  });
  const pros = await prisma.leadProspecto.create({
    data: { empresaId, telefonoProspecto: TEL, conversacionId: conv.id, etapa: 'POR_DESPACHAR' },
  });
  await prisma.leadPedidoBorrador.upsert({
    where: { conversacionId: conv.id },
    create: {
      empresaId,
      conversacionId: conv.id,
      zona: 'Provincia',
      tipoZona: 'AGENCIA',
      lugar: 'CUSCO',
      comprobanteId: comprobante.id,
      registradoEn: new Date(),
      itemsJson: producto ? [{ productoId: producto.id, cantidad: 2 }] : [],
      descuentoAplicado: new Prisma.Decimal(0),
    },
    update: { comprobanteId: comprobante.id, registradoEn: new Date() },
  });

  // Un envío por Shalom, como lo crea el panel.
  await prisma.envioDespacho.create({
    data: {
      comprobanteId: comprobante.id,
      estado: 'EN_CAMINO',
      transportista: 'SHALOM_PRO',
      tipoEnvio: 'AGENCIA',
      agenciaDestino: 'CUSCO CENTRO',
      codigoGuia: 'SHL-QA-001',
      claveEnvio: '4821',
      shalomEstado: 'transito',
      celularDest: TEL,
    },
  });

  // ── Shalom dice "entregado": el scheduler llama a update(), igual que en producción ──
  console.log('\n── El scheduler de Shalom marca el envío como entregado ──');
  const antes = Date.now();
  await despachos.update(
    comprobante.id,
    empresaId,
    { estado: EstadoDespacho.ENTREGADO } as never,
    undefined,
  );

  // El aviso se manda sin esperarlo (`.catch()` sin await) para no demorar la
  // respuesta del panel: se le da un momento antes de comprobarlo.
  await new Promise((r) => setTimeout(r, 400));

  const despacho = await prisma.envioDespacho.findUnique({
    where: { comprobanteId: comprobante.id },
    select: { estado: true, entregadoEn: true, historial: true },
  });
  ok(String(despacho?.estado) === 'ENTREGADO', 'el despacho queda ENTREGADO');
  ok(
    !!despacho?.entregadoEn,
    'y `entregadoEn` SE SELLA por el camino de Shalom, no solo a mano',
    despacho?.entregadoEn?.toISOString() ?? 'vacío',
  );
  ok(
    !!despacho?.entregadoEn && despacho.entregadoEn.getTime() >= antes - 5000,
    'con la hora del momento de la entrega',
  );
  ok(
    avisos.length > 0,
    'y le avisa al cliente por WhatsApp, como ya hacía',
    `${avisos.length} aviso(s)`,
  );

  // ── Ahora la parte nueva: ¿el CRM se enteró? ──
  console.log('\n── El CRM debe enterarse solo ──');
  await disparos.reconciliarConDespachos();

  const etapa = await prisma.leadProspecto.findUnique({
    where: { id: pros.id },
    select: { etapa: true },
  });
  ok(
    String(etapa?.etapa) === 'ENTREGADO',
    'el embudo pasa de POR_DESPACHAR a ENTREGADO sin que nadie lo toque',
    String(etapa?.etapa),
  );

  const resena = await prisma.leadDisparo.findFirst({
    where: { empresaId, telefono: TEL, tipo: 'POST_ENTREGA' },
    select: { programadoPara: true, referencia: true },
  });
  ok(!!resena, 'queda programada la reseña de postventa (33.4)');
  if (resena) {
    const h = (resena.programadoPara.getTime() - Date.now()) / 3600_000;
    ok(h > 23 && h < 25, 'a 24 h de la entrega real', `${h.toFixed(1)} h`);
  }

  if (producto) {
    const recompra = await prisma.leadDisparo.findFirst({
      where: { empresaId, telefono: TEL, tipo: 'RECOMPRA' },
      select: { referencia: true },
    });
    ok(
      recompra?.referencia === `producto:${producto.id}`,
      'y la recompra del producto que viajó (33.5)',
      recompra?.referencia ?? 'no se programó',
    );
  }

  // ── Un envío devuelto por Shalom debe reprogramar, no cerrar ──
  console.log('\n── Shalom devuelve el paquete ──');
  await despachos.update(
    comprobante.id,
    empresaId,
    { estado: EstadoDespacho.DEVUELTO } as never,
    undefined,
  );
  await disparos.reconciliarConDespachos();
  const trasDevolucion = await prisma.leadProspecto.findUnique({
    where: { id: pros.id },
    select: { etapa: true },
  });
  ok(
    String(trasDevolucion?.etapa) === 'REPROGRAMADO',
    'un envío devuelto deja el pedido en REPROGRAMADO, no perdido',
    String(trasDevolucion?.etapa),
  );

  await limpiar();
  await prisma.cliente.update({
    where: { id: comprobante.clienteId },
    data: { telefono: cliente?.telefono ?? null },
  });
  await prisma.empresa.update({
    where: { id: empresaId },
    data: { iaVentasConfigJson: Prisma.DbNull },
  });

  console.log(
    fallos === 0
      ? '\n✔ La costura con Shalom funciona: lo que su scheduler escribe mueve el CRM.'
      : `\n✗ ${fallos} fallo(s).`,
  );
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
