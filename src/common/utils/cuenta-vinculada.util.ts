/**
 * Resuelve la cuenta bancaria vinculada a un medio de pago digital (YAPE/PLIN)
 * de la empresa. Yape y Plin abonan directo a la cuenta bancaria asociada, así
 * que todo pago con esos medios se atribuye automáticamente a esa cuenta —
 * queda trazable en reportes/conciliación y fuera del flujo manual de depósitos
 * de caja (que solo maneja efectivo).
 *
 * Devuelve el id de la cuenta activa vinculada, o null si el medio no es
 * YAPE/PLIN o la empresa no configuró el vínculo.
 */
export async function resolverCuentaVinculada(
  prisma: {
    cuentaBancaria: {
      findFirst: (args: any) => Promise<{ id: number } | null>;
    };
  },
  empresaId: number,
  medioPago?: string | null,
): Promise<number | null> {
  const medio = String(medioPago || '')
    .trim()
    .toUpperCase();
  if (medio !== 'YAPE' && medio !== 'PLIN') return null;
  const cuenta = await prisma.cuentaBancaria.findFirst({
    where: { empresaId, medioPagoVinculado: medio, activo: true },
    select: { id: true },
  });
  return cuenta?.id ?? null;
}
