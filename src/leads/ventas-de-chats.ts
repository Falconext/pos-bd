import { NOTA_SIN_CONVERTIR, SELECT_CONVERSION, formalDeNota } from '../comprobante/convertidos';
import { TIPOS_VENTA, celular9, dniUtil } from './meta-conversiones';

/**
 * Qué ventas salieron de qué chats, para la Analítica de la IA de Ventas.
 *
 * Antes la Analítica solo contaba la venta registrada con el pedido del chat
 * (`LeadPedidoBorrador.comprobanteId`). En Krezka (01-11) el prospecto se
 * convirtió en cliente y la NV01-70 se hizo a mano: Meta la recibió como
 * compra, pero el panel decía "Ventas 0". Ahora se reconoce igual que en la
 * API de Conversiones, de lo más seguro a lo menos:
 *   1. la nota que salió del pedido del chat;
 *   2. el cliente en que se convirtió el prospecto;
 *   3. un cliente con el mismo celular del chat (WhatsApp);
 *   4. un cliente con el DNI que dio en el chat.
 * Por 2-4 solo cuenta lo vendido desde que escribió y hasta 30 días después
 * de su último mensaje: una compra de hace un año no la trajo este chat.
 */

export const DIAS_TRAS_CHAT = 30;
const DIA_MS = 24 * 3600 * 1000;

export interface ChatParaVentas {
  id: number;
  creadoEn: Date;
  actualizadoEn: Date;
  telefonoProspecto: string;
  canal: string;
  clienteId: number | null;
  comprobanteId: number | null;
  dni: string | null;
}

export interface VentaCandidata {
  id: number;
  clienteId: number | null;
  monto: number;
  creadoEn: Date;
}

export interface VentaDeChat {
  conversacionId: number;
  comprobanteId: number;
  monto: number;
  fecha: Date;
}

/**
 * Le asigna cada venta a un solo chat (el primero por orden de seguridad) y
 * nunca cuenta una venta dos veces.
 */
export function asignarVentas(
  chats: ChatParaVentas[],
  ventas: VentaCandidata[],
  celularDeCliente: Map<number, string>,
  dniDeCliente: Map<number, string>,
): VentaDeChat[] {
  const porComprobante = new Map<number, ChatParaVentas>();
  const porCliente = new Map<number, ChatParaVentas[]>();
  const porCelular = new Map<string, ChatParaVentas[]>();
  const porDni = new Map<string, ChatParaVentas[]>();
  const agregar = <K>(m: Map<K, ChatParaVentas[]>, k: K, c: ChatParaVentas) => m.set(k, [...(m.get(k) ?? []), c]);
  for (const c of chats) {
    if (c.comprobanteId) porComprobante.set(c.comprobanteId, c);
    if (c.clienteId) agregar(porCliente, c.clienteId, c);
    const cel = c.canal === 'WHATSAPP' ? celular9(c.telefonoProspecto) : null;
    if (cel) agregar(porCelular, cel, c);
    const dni = dniUtil(c.dni);
    if (dni) agregar(porDni, dni, c);
  }
  const enVentana = (c: ChatParaVentas, fecha: Date) =>
    fecha.getTime() >= c.creadoEn.getTime() - 3600 * 1000 &&
    fecha.getTime() <= c.actualizadoEn.getTime() + DIAS_TRAS_CHAT * DIA_MS;

  const salida: VentaDeChat[] = [];
  for (const v of ventas) {
    const directo = porComprobante.get(v.id);
    let chat: ChatParaVentas | undefined = directo;
    if (!chat && v.clienteId != null) {
      const cel = celularDeCliente.get(v.clienteId);
      const dni = dniDeCliente.get(v.clienteId);
      const candidatos = [
        ...(porCliente.get(v.clienteId) ?? []),
        ...(cel ? (porCelular.get(cel) ?? []) : []),
        ...(dni ? (porDni.get(dni) ?? []) : []),
      ];
      chat = candidatos.find((c) => enVentana(c, v.creadoEn));
    }
    if (chat) salida.push({ conversacionId: chat.id, comprobanteId: v.id, monto: v.monto, fecha: v.creadoEn });
  }
  return salida;
}

const anulada = (c: { estadoPago?: unknown; estadoEnvioSunat?: unknown }) =>
  String(c.estadoPago) === 'ANULADO' || ['ANULADO', 'RECHAZADO'].includes(String(c.estadoEnvioSunat));

/** Las ventas de esos chats, buscadas en la base. */
export async function ventasDeChats(prisma: any, empresaId: number, convIds: number[]): Promise<VentaDeChat[]> {
  if (!convIds.length) return [];
  const convs = await prisma.leadConversacion.findMany({
    where: { empresaId, id: { in: convIds } },
    select: {
      id: true,
      creadoEn: true,
      actualizadoEn: true,
      telefonoProspecto: true,
      canal: true,
      prospecto: { select: { clienteId: true } },
      borrador: { select: { comprobanteId: true, dni: true } },
    },
  });
  // La nota del pedido que después se pasó a boleta o factura cuenta por su
  // formal: la nota convertida ya no es venta (NOTA_SIN_CONVERTIR).
  const notas = convs.map((c: any) => c.borrador?.comprobanteId).filter((x: any): x is number => x != null);
  const formalDe = new Map<number, number>();
  if (notas.length) {
    const conv = await prisma.comprobante.findMany({
      where: { empresaId, id: { in: notas } },
      select: { id: true, ...SELECT_CONVERSION },
    });
    for (const n of conv) {
      const f = formalDeNota(n);
      if (f) formalDe.set(n.id, f.id);
    }
  }
  const chats: ChatParaVentas[] = convs.map((c: any) => {
    const nota = c.borrador?.comprobanteId ?? null;
    return {
      id: c.id,
      creadoEn: c.creadoEn,
      actualizadoEn: c.actualizadoEn,
      telefonoProspecto: c.telefonoProspecto,
      canal: c.canal,
      clienteId: c.prospecto?.clienteId ?? null,
      comprobanteId: nota != null ? (formalDe.get(nota) ?? nota) : null,
      dni: c.borrador?.dni ?? null,
    };
  });

  const celulares = [...new Set(chats.filter((c) => c.canal === 'WHATSAPP').map((c) => celular9(c.telefonoProspecto)).filter(Boolean))] as string[];
  const dnis = [...new Set(chats.map((c) => dniUtil(c.dni)).filter(Boolean))] as string[];
  // Por dígitos: en la ficha el celular suele estar como "987 654 321".
  const porCelular: { id: number; telefono: string | null }[] = celulares.length
    ? await prisma.$queryRaw`
        SELECT id, telefono FROM "Cliente"
        WHERE "empresaId" = ${empresaId}
          AND right(regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g'), 9) = ANY(${celulares})`
    : [];
  const porDni: { id: number; nroDoc: string }[] = dnis.length
    ? await prisma.cliente.findMany({ where: { empresaId, nroDoc: { in: dnis } }, select: { id: true, nroDoc: true } })
    : [];
  const celularDeCliente = new Map<number, string>();
  for (const cl of porCelular) {
    const cel = celular9(cl.telefono);
    if (cel) celularDeCliente.set(cl.id, cel);
  }
  const dniDeCliente = new Map<number, string>(porDni.map((cl) => [cl.id, cl.nroDoc]));

  const clienteIds = [...new Set([...chats.map((c) => c.clienteId).filter((x): x is number => x != null), ...celularDeCliente.keys(), ...dniDeCliente.keys()])];
  const comprobanteIds = chats.map((c) => c.comprobanteId).filter((x): x is number => x != null);
  if (!clienteIds.length && !comprobanteIds.length) return [];
  const desde = new Date(Math.min(...chats.map((c) => c.creadoEn.getTime())) - 3600 * 1000);

  const filas = await prisma.comprobante.findMany({
    where: {
      empresaId,
      OR: [
        ...(comprobanteIds.length ? [{ id: { in: comprobanteIds } }] : []),
        ...(clienteIds.length ? [{ clienteId: { in: clienteIds }, creadoEn: { gte: desde } }] : []),
      ],
      AND: [
        {
          OR: [
            { tipoDoc: { in: ['01', '03'] } },
            // Una nota ya convertida cuenta por su boleta o factura.
            { tipoDoc: { in: TIPOS_VENTA.filter((t) => !['01', '03'].includes(t)) }, ...NOTA_SIN_CONVERTIR },
          ],
        },
      ],
    },
    select: { id: true, clienteId: true, mtoImpVenta: true, creadoEn: true, estadoPago: true, estadoEnvioSunat: true },
    orderBy: { creadoEn: 'asc' },
  });
  const ventas: VentaCandidata[] = filas
    .filter((f: any) => !anulada(f))
    .map((f: any) => ({ id: f.id, clienteId: f.clienteId, monto: Number(f.mtoImpVenta ?? 0), creadoEn: f.creadoEn }));
  return asignarVentas(chats, ventas, celularDeCliente, dniDeCliente);
}
