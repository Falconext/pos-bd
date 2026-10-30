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
    /** N° de orden de Shalom/Olva: con eso el cliente rastrea o retira. */
    nroOrden?: string | null;
    /** Etapa del rastreo del courier (shalomEstado / olvaEstado), que se actualiza sola. */
    etapaCourier?: string | null;
    /** Clave de recojo. Solo cuando el envío va a ESTE número: con ella se retira el paquete. */
    claveRecojo?: string | null;
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

// El rastreo del courier va por delante del estado que se marca a mano: el
// paquete llega a la agencia y nadie cambia el despacho hasta el día siguiente.
const ETAPA_COURIER: Record<string, string> = {
  registrado: 'registrado en el courier (todavía no sale)',
  origen: 'en la agencia de origen, por salir',
  transito: 'en camino',
  reparto: 'en reparto, lo están llevando a la dirección',
  destino: 'esperando en la agencia para que lo recoja',
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
      const estado =
        ETAPA_COURIER[p.despacho.etapaCourier ?? ''] ?? ESTADO_LEGIBLE[p.despacho.estado] ?? p.despacho.estado.toLowerCase();
      partes.push(
        `envío${via ? ` por ${via}` : ''}: ${estado}${p.despacho.agenciaDestino ? ` (agencia ${p.despacho.agenciaDestino})` : ''}${
          p.despacho.codigoGuia ? `, guía ${p.despacho.codigoGuia}` : ''
        }${p.despacho.nroOrden ? `, N° de orden ${p.despacho.nroOrden}` : ''}${
          p.despacho.claveRecojo ? `, clave de recojo ${p.despacho.claveRecojo}` : ''
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

/** Una venta ya terminada (entregada o sin envío, y pagada). */
export interface CompraAnterior {
  fechaEmision: Date;
  productos: string[];
}

// La línea del flete ("ENVÍO DELIVERY", "ENVÍO AGENCIA SHALOM - …") no es algo que compró.
export const esLineaDeEnvio = (descripcion: string) => /^\s*(env[ií]o|delivery|flete)\b/i.test(descripcion);

/**
 * Lo que el cliente ya compró y la guía de consumo que se le envió (30-10).
 *
 * El bloque de pedidos en curso deja de ver una venta apenas se entrega y se
 * paga; desde ahí el bot lo atendía como a un desconocido: le volvía a
 * preguntar qué buscaba y no entendía "lo mismo de la otra vez". La recompra
 * es la venta más barata que tiene el negocio.
 */
export function contextoHistorialCliente(
  compras: CompraAnterior[],
  guia: { texto: string; en: Date | null } | null,
): string {
  const partes: string[] = [];
  if (compras.length) {
    const fmt = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: 'numeric', month: 'short', year: 'numeric' });
    partes.push(
      'COMPRAS ANTERIORES DE ESTE CLIENTE (ya entregadas y pagadas):',
      ...compras.slice(0, 5).map((c) => `- ${fmt.format(c.fechaEmision)}: ${c.productos.slice(0, 5).join(', ') || 'productos'}.`),
      'Atiéndelo como cliente que vuelve: si pide "lo mismo" o "lo de siempre", ya sabes qué es; puedes preguntarle cómo le fue y ofrecerle reponer. No le recites la lista ni le digas que la tienes; los precios y el stock búscalos de nuevo.',
    );
  }
  const texto = guia?.texto?.trim();
  if (texto) {
    const cuando = guia?.en
      ? ` (enviada el ${new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: 'numeric', month: 'short' }).format(guia.en)})`
      : '';
    partes.push(
      `GUÍA DE CONSUMO QUE EL NEGOCIO LE ENVIÓ${cuando}:`,
      texto.slice(0, 1500),
      'Si pregunta cómo tomar o usar lo que compró, contéstale con esta guía tal cual: no cambies dosis, horarios ni cantidades.',
    );
  }
  return partes.join('\n');
}
