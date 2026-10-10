/**
 * ¿`registrar_pedido` funciona de verdad?
 *
 * Los tests del flujo usan un `crearInformal` de mentira que devuelve un id,
 * y por eso no vieron que el registro fallaba SIEMPRE en producción: el
 * comprobante pide un `clienteId` y se le estaba pasando el nombre del
 * cliente como texto.
 *
 * Esto levanta la aplicación ENTERA contra la base local y llama al servicio
 * real, con el ComprobanteService real. Es la única forma de comprobarlo sin
 * tocar producción.
 *
 *   export DATABASE_URL=postgresql://postgres:developer@localhost:5432/sistema_mype
 *   npx ts-node --transpile-only scripts/qa-registrar-pedido-real.ts
 */
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { LeadsPedidoService } from '../src/leads/leads-pedido.service';
import { CONFIG_ENVIO_HIERBA_SANA } from '../src/leads/envio-zonas';
import { REGLAS_HIERBA_SANA } from '../src/leads/reglas-descuento';

const TEL = '51900777999';
const DNI = '70123456';

let fallos = 0;
const ok = (c: boolean, t: string, d = '') => {
  console.log(`${c ? '✔' : '✗'} ${t}${d ? ` — ${d}` : ''}`);
  if (!c) fallos++;
};

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL no apunta a localhost. Esto NO se corre contra producción.');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const prisma = app.get(PrismaService);
  const pedido = app.get(LeadsPedidoService);

  // Una empresa que pueda emitir: con serie de NV y con productos.
  const [fila] = await prisma.$queryRaw<{ empresaId: number }[]>`
    SELECT c."empresaId" FROM "Comprobante" c
    WHERE c."tipoDoc" = 'NV'
    GROUP BY c."empresaId" ORDER BY COUNT(*) DESC LIMIT 1`;
  if (!fila) throw new Error('Ninguna empresa local tiene notas de venta.');
  const empresaId = fila.empresaId;

  const producto = await prisma.producto.findFirst({
    where: { empresaId, estado: 'ACTIVO' as never },
    select: { id: true, descripcion: true, precioUnitario: true, stock: true },
  });
  if (!producto) throw new Error('La empresa de prueba no tiene productos.');
  console.log(
    `Empresa ${empresaId} · producto ${producto.id} "${producto.descripcion}" ` +
      `S/ ${Number(producto.precioUnitario)} · stock ${Number(producto.stock)}\n`,
  );

  const limpiar = async () => {
    await prisma.leadConversacion.deleteMany({
      where: { empresaId, telefonoProspecto: TEL },
    });
    await prisma.cliente
      .deleteMany({ where: { empresaId, nroDoc: DNI } })
      .catch(() => undefined);
  };
  await limpiar();

  await prisma.empresa.update({
    where: { id: empresaId },
    data: {
      iaVentasConfigJson: {
        envio: CONFIG_ENVIO_HIERBA_SANA,
        descuento: REGLAS_HIERBA_SANA,
      } as never,
    },
  });

  const conv = await prisma.leadConversacion.create({
    data: { empresaId, telefonoProspecto: TEL, nombreProspecto: 'QA REGISTRO' },
  });
  await prisma.leadProspecto.create({
    data: { empresaId, telefonoProspecto: TEL, conversacionId: conv.id },
  });

  // Un pedido a provincia, con TODOS los datos: igual que el de la prueba real.
  await prisma.leadPedidoBorrador.create({
    data: {
      empresaId,
      conversacionId: conv.id,
      zona: 'Provincia',
      tipoZona: 'AGENCIA',
      lugar: 'TRUJILLO',
      costoEnvio: new Prisma.Decimal(10),
      nombre: 'Edwing Ortega',
      dni: DNI,
      celular: '915947349',
      agenciaSede: 'Shalom Trujillo Centro',
      itemsJson: [{ productoId: producto.id, cantidad: 3 }],
    },
  });

  // El stock se mide por SEDE. `producto.stock` es la suma de todas y puede
  // estar desactualizado, así que comparar contra él da falsos negativos.
  const stockDeSede = async (): Promise<{ sedeId: number; stock: number } | null> => {
    const filas: { sedeId: number; stock: number }[] = await prisma.$queryRawUnsafe(
      `SELECT "sedeId", stock::int AS stock FROM "ProductoStock"
        WHERE "productoId" = ${producto.id} ORDER BY "sedeId" LIMIT 1`,
    );
    return filas[0] ?? null;
  };
  const antes = await stockDeSede();

  // ── Lo que falla en producción ──
  console.log('── registrarPedido, con el ComprobanteService real ──');
  const r = await pedido.registrarPedido(empresaId, conv.id, TEL);

  ok(!r.error, 'no devuelve error', r.error ?? '');
  ok(!!r.registrado, 'devuelve el pedido registrado', JSON.stringify(r.pedido ?? r).slice(0, 120));

  const borrador = await prisma.leadPedidoBorrador.findUnique({
    where: { conversacionId: conv.id },
    select: { comprobanteId: true },
  });
  ok(
    !!borrador?.comprobanteId,
    'el borrador queda enlazado al comprobante',
    String(borrador?.comprobanteId ?? 'null'),
  );

  if (borrador?.comprobanteId) {
    const nv = await prisma.comprobante.findUnique({
      where: { id: borrador.comprobanteId },
      select: {
        serie: true,
        correlativo: true,
        tipoDoc: true,
        mtoImpVenta: true,
        clienteId: true,
        cliente: { select: { nombre: true, nroDoc: true, telefono: true } },
      },
    });
    ok(nv?.tipoDoc === 'NV', 'es una nota de venta', `${nv?.serie}-${nv?.correlativo}`);
    ok(
      !!nv?.clienteId,
      'va a nombre de un CLIENTE de verdad, no de un texto suelto',
      nv?.cliente?.nombre ?? '',
    );
    ok(
      nv?.cliente?.nroDoc === DNI,
      'con su DNI guardado',
      nv?.cliente?.nroDoc ?? '',
    );
    ok(
      nv?.cliente?.telefono === '915947349',
      'y su celular, para que le llegue el aviso de entrega',
      nv?.cliente?.telefono ?? '(vacío)',
    );
    // 3 × precio, menos el descuento si corresponde: lo que importa es que
    // el monto no sea cero ni absurdo.
    ok(Number(nv?.mtoImpVenta ?? 0) > 0, 'con un monto', `S/ ${Number(nv?.mtoImpVenta)}`);

    const despacho = await prisma.envioDespacho.findUnique({
      where: { comprobanteId: borrador.comprobanteId },
      select: { estado: true, tipoEnvio: true, agenciaDestino: true },
    });
    ok(!!despacho, 'y con su despacho creado', JSON.stringify(despacho ?? {}));

    const despues = await stockDeSede();
    ok(
      !!antes && !!despues && despues.stock === antes.stock - 3,
      'descontó 3 unidades del stock de la sede',
      `sede ${antes?.sedeId}: ${antes?.stock} → ${despues?.stock}`,
    );
    const movimiento: { n: number }[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "MovimientoKardex"
        WHERE "productoId" = ${producto.id} AND "comprobanteId" = ${borrador.comprobanteId}`,
    );
    ok(movimiento[0]?.n === 1, 'y dejó su movimiento en el kardex');

    // ── Idempotencia: insistir no crea un segundo pedido ──
    const otra = await pedido.registrarPedido(empresaId, conv.id, TEL);
    ok(
      !!otra.error && /ya estaba registrado/i.test(otra.error),
      'insistir no registra el pedido dos veces',
      otra.error ?? '',
    );

    // ── Limpieza: borrar la NV revierte el stock ──
    // La nota de venta cuelga de varias tablas; se borran en orden o la
    // clave foránea lo impide (Leyenda es la que menos se espera).
    const id = borrador.comprobanteId;
    for (const sql of [
      `DELETE FROM "EnvioDespacho" WHERE "comprobanteId" = ${id}`,
      `DELETE FROM "MovimientoKardex" WHERE "comprobanteId" = ${id}`,
      `DELETE FROM "DetalleComprobante" WHERE "comprobanteId" = ${id}`,
      `DELETE FROM "Leyenda" WHERE "comprobanteId" = ${id}`,
      `DELETE FROM "Comprobante" WHERE id = ${id}`,
    ]) {
      await prisma.$executeRawUnsafe(sql).catch(() => undefined);
    }
    if (antes) {
      await prisma.$executeRawUnsafe(
        `UPDATE "ProductoStock" SET stock = ${antes.stock}
          WHERE "productoId" = ${producto.id} AND "sedeId" = ${antes.sedeId}`,
      );
    }
    console.log('\n(limpieza: nota de venta borrada y stock restaurado)');
  }

  await limpiar();
  await prisma.empresa.update({
    where: { id: empresaId },
    data: { iaVentasConfigJson: Prisma.DbNull },
  });

  console.log(
    fallos === 0
      ? '\n✔ registrar_pedido FUNCIONA con el comprobante real.'
      : `\n✗ ${fallos} fallo(s).`,
  );
  await app.close();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
