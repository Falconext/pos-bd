/**
 * Borrado FÍSICO y completo de una empresa y TODOS sus datos relacionados.
 *
 * ⚠️  IRREVERSIBLE. Haz un backup de producción (pg_dump) ANTES de correr esto.
 *
 * Uso (protegido):
 *   EMPRESA_ID=27 RUC_ESPERADO=20615698432 CONFIRMAR=SI \
 *     npx ts-node -r tsconfig-paths/register src/scripts/eliminar-empresa.ts
 *
 * - Verifica que la empresa exista y que su RUC coincida con RUC_ESPERADO
 *   (para no borrar la empresa equivocada).
 * - Exige CONFIRMAR=SI.
 * - Borra todo en una única transacción: si algo falla, NO borra nada
 *   (rollback total) y muestra el error/tabla que faltó.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const empresaId = Number(process.env.EMPRESA_ID);
  const rucEsperado = String(process.env.RUC_ESPERADO || '').trim();
  const confirmar = String(process.env.CONFIRMAR || '')
    .trim()
    .toUpperCase();

  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    throw new Error('Falta EMPRESA_ID (número). Ej: EMPRESA_ID=27');
  }
  if (confirmar !== 'SI') {
    throw new Error('Falta CONFIRMAR=SI. Abortado por seguridad.');
  }

  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { id: true, ruc: true, razonSocial: true, nombreComercial: true },
  });
  if (!empresa) throw new Error(`No existe empresa con id=${empresaId}`);

  if (rucEsperado && empresa.ruc !== rucEsperado) {
    throw new Error(
      `RUC no coincide. Esperado ${rucEsperado}, encontrado ${empresa.ruc} (${empresa.razonSocial}). Abortado.`,
    );
  }

  console.log('▶ Empresa a ELIMINAR físicamente:');
  console.log(
    `   id=${empresa.id}  RUC=${empresa.ruc}  ${empresa.razonSocial}`,
  );
  console.log('   Iniciando transacción...');

  const where = { empresaId } as const;

  await prisma.$transaction(
    async (tx) => {
      // ── Fase A: hijos / detalles / movimientos (referencian producto/comprobante/usuario/etc.) ──
      await tx.detalleComprobante.deleteMany({
        where: { comprobante: { empresaId } },
      });
      await tx.leyenda.deleteMany({ where: { comprobante: { empresaId } } });
      await tx.productoSerie.deleteMany({ where });
      await tx.detalleCompra.deleteMany({ where: { compra: { empresaId } } });
      await tx.detalleGuiaRemision.deleteMany({
        where: { guiaRemision: { empresaId } },
      });
      await tx.itemPedidoTienda.deleteMany({
        where: { pedido: { empresaId } },
      });
      await tx.historialEstadoPedido.deleteMany({
        where: { pedido: { empresaId } },
      });
      await tx.productoReview.deleteMany({ where });
      await tx.movimientoKardex.deleteMany({ where });
      await tx.movimientoProduccion.deleteMany({ where });
      await tx.movimientoCaja.deleteMany({ where });
      await tx.refreshToken.deleteMany({ where: { usuario: { empresaId } } });
      await tx.comisionVendedor.deleteMany({ where });
      await tx.campanaMarketing.deleteMany({ where });
      await tx.pago.deleteMany({ where });
      await tx.pagoCompra.deleteMany({ where });

      // ── Fase B: entidades intermedias ──
      await tx.ordenProduccion.deleteMany({ where });
      await tx.guiaRemision.deleteMany({ where });
      await tx.pedidoTienda.deleteMany({ where });
      await tx.comprobante.deleteMany({ where });
      await tx.compra.deleteMany({ where });
      await tx.producto.deleteMany({ where });
      await tx.categoria.deleteMany({ where });
      await tx.marca.deleteMany({ where });
      await tx.cuentaBancaria.deleteMany({ where });
      await tx.cliente.deleteMany({ where });
      await tx.doctor.deleteMany({ where });
      await tx.resellerMovimiento.deleteMany({ where });
      await tx.usuario.deleteMany({ where });

      // ── Fase C: la empresa (cascadea el resto: sedes, banners, combos, reservas, etc.) ──
      await tx.empresa.delete({ where: { id: empresaId } });
    },
    { timeout: 120000 },
  );

  console.log('✅ Empresa eliminada por completo.');
}

main()
  .catch((e) => {
    console.error('❌ NADA fue borrado (rollback). Error:', e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
