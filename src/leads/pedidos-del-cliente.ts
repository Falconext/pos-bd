/**
 * Los pedidos en curso del cliente, aunque no los haya cerrado el bot.
 *
 * Hierba Sana, 23-10: el empresario vende por su número personal y registra
 * la venta en Krezka. Cuando el cliente le escribía al número del negocio
 * ("¿ya llegó?", "¿cuánto debo?"), el bot no sabía que tenía un pedido y
 * volvía a venderle. Se busca por celular y va en el contexto del turno.
 */

export interface PedidoDelCliente {
  serie: string;
  correlativo: number;
  fechaEmision: Date;
  total: number;
  saldo: number;
  productos: string[];
  despacho?: {
    estado: string;
    transportista?: string | null;
    agenciaDestino?: string | null;
    codigoGuia?: string | null;
    /** "Tony Cayo (cel. 955 947 892)". */
    repartidor?: string | null;
    /** Cómo pagarle al recibir, según si es del equipo o contratado. */
    formasDePago?: string | null;
  } | null;
}

const ESTADO_LEGIBLE: Record<string, string> = {
  PREPARANDO: 'en preparación (todavía no sale)',
  EN_CAMINO: 'en camino',
  EN_AGENCIA: 'esperando en la agencia para que lo recoja',
  EN_DESTINO: 'en la ciudad de destino',
};

const TRANSPORTISTA: Record<string, string> = {
  SHALOM_PRO: 'Shalom',
  SHALOM_COD: 'Shalom',
  OLVA: 'Olva',
  PROPIOS: 'reparto propio',
};

const soles = (n: number) => `S/ ${n.toFixed(2)}`;

export function contextoPedidosDelCliente(pedidos: PedidoDelCliente[]): string {
  if (!pedidos.length) return '';
  const lineas = pedidos.slice(0, 3).map((p) => {
    const ref = `${p.serie}-${String(p.correlativo).padStart(8, '0')}`;
    const fecha = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: 'numeric', month: 'short' }).format(p.fechaEmision);
    const partes = [`${ref} del ${fecha}: ${p.productos.slice(0, 4).join(', ') || 'productos'}; total ${soles(p.total)}`];
    partes.push(p.saldo > 0.009 ? `falta pagar ${soles(p.saldo)}` : 'pagado');
    if (p.despacho) {
      const via = TRANSPORTISTA[p.despacho.transportista ?? ''] ?? p.despacho.transportista ?? '';
      const estado = ESTADO_LEGIBLE[p.despacho.estado] ?? p.despacho.estado.toLowerCase();
      partes.push(
        `envío${via ? ` por ${via}` : ''}: ${estado}${p.despacho.agenciaDestino ? ` (agencia ${p.despacho.agenciaDestino})` : ''}${
          p.despacho.codigoGuia ? `, guía ${p.despacho.codigoGuia}` : ''
        }${p.despacho.repartidor ? `, lo lleva ${p.despacho.repartidor}` : ''}`,
      );
      if (p.despacho.formasDePago && p.saldo > 0.009) partes.push(`formas de pago al recibir: ${p.despacho.formasDePago}`);
    }
    return `- ${partes.join('; ')}.`;
  });
  return [
    'PEDIDOS EN CURSO DE ESTE CLIENTE (ya registrados por el negocio, aunque no los hayas cerrado tú):',
    ...lineas,
    'Si pregunta por su pedido, su envío, la agencia o cuánto debe, respóndele con esto. No le vuelvas a cotizar ni registres un pedido nuevo por esos productos. Si quiere pagar el saldo, dale los medios de pago del contexto del negocio.',
  ].join('\n');
}
