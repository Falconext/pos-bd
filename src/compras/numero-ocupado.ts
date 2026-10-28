import { EstadoCompra, Prisma } from '@prisma/client';

/**
 * Qué compras ocupan su serie-número.
 *
 * TIENDA MINERA (28-10): registró la F100-00512547 con un error, la eliminó
 * (que en realidad la anula: queda guardada para el historial y sale de la
 * lista) y al volver a ingresarla le decía "ya existe". La compra que lo
 * bloqueaba era la anulada, que él ya no podía ver ni tocar.
 *
 * Una compra anulada o rechazada nunca movió stock ni dinero que siga vigente,
 * así que su número queda libre para registrar la correcta.
 */
export const ESTADOS_QUE_LIBERAN_NUMERO: EstadoCompra[] = [
  'ANULADO',
  'RECHAZADA',
];

export const COMPRA_OCUPA_NUMERO: Prisma.CompraWhereInput = {
  estado: { notIn: ESTADOS_QUE_LIBERAN_NUMERO },
};
