/**
 * Puntaje del vendedor: qué tan lista está la IA de Ventas para vender.
 *
 * La mayoría de negocios enciende la IA y deja vacío "Mi vendedor"; después
 * la IA responde genérico y el dueño cree que "no sirve". YaVendió lo resuelve
 * con un puntaje y una lista de lo que falta, y eso es lo que hace esto.
 *
 * Es una cuenta, no una consulta al modelo: sale gratis, es igual cada vez
 * que se abre, y cada punto que falta dice exactamente dónde se arregla.
 */

export type PestanaVendedor = 'personalidad' | 'conocimiento' | 'entrega' | 'pagos' | 'ajustes';

/** Lo que se mira de la empresa. Lo arma `LeadsService.puntajeVendedor`. */
export interface DatosPuntaje {
  whatsappConectado: boolean;
  iaActiva: boolean;
  productosConPrecio: number;
  productosConFoto: number;
  asesor: string;
  audiencia: string;
  estilo: string;
  reglas: string;
  saludo: boolean;
  temasConocimiento: number;
  largoContexto: number;
  documentosIndexados: number;
  zonasEnvio: number;
  mediosPago: number;
  mensajeDerivacion: string;
}

export interface ItemPuntaje {
  id: string;
  titulo: string;
  ok: boolean;
  puntos: number;
  /** Qué hacer para sumarlo. */
  consejo: string;
  /** Dónde se arregla dentro de Mi vendedor… */
  pestana?: PestanaVendedor;
  /** …o fuera de él. */
  ruta?: string;
}

export interface Puntaje {
  puntaje: number;
  nivel: 'LISTO' | 'CASI' | 'FALTA';
  items: ItemPuntaje[];
}

const FOTOS_MINIMAS = 0.6;
const CONTEXTO_MINIMO = 300;
const TEMAS_MINIMOS = 3;

export function calcularPuntaje(d: DatosPuntaje): Puntaje {
  const proporcionFotos = d.productosConPrecio ? d.productosConFoto / d.productosConPrecio : 0;
  const items: ItemPuntaje[] = [
    {
      id: 'whatsapp',
      titulo: 'WhatsApp conectado',
      ok: d.whatsappConectado,
      puntos: 10,
      consejo: 'Conecta tu número para que la IA atienda a tus clientes.',
      ruta: '/administrador/perfil',
    },
    {
      id: 'ia',
      titulo: 'IA encendida',
      ok: d.iaActiva,
      puntos: 5,
      consejo: 'Enciende la IA de Ventas para que responda sola.',
      pestana: 'ajustes',
    },
    {
      id: 'catalogo',
      titulo: 'Productos con precio',
      ok: d.productosConPrecio > 0,
      puntos: 10,
      consejo: 'Carga tus productos con precio: la IA cotiza con tu catálogo real.',
      ruta: '/administrador/kardex',
    },
    {
      id: 'fotos',
      titulo: 'Productos con foto',
      ok: d.productosConPrecio > 0 && proporcionFotos >= FOTOS_MINIMAS,
      puntos: 10,
      consejo: `Ponle foto a la mayoría de tus productos (tienes ${Math.round(proporcionFotos * 100)}%): la IA las envía cuando el cliente pregunta.`,
      ruta: '/administrador/kardex',
    },
    {
      id: 'audiencia',
      titulo: 'A quién le vendes',
      ok: !!d.audiencia.trim(),
      puntos: 8,
      consejo: 'Cuéntale a tu vendedor quién es tu cliente típico.',
      pestana: 'personalidad',
    },
    {
      id: 'estilo',
      titulo: 'Cómo habla y cómo vende',
      ok: !!d.estilo.trim(),
      puntos: 5,
      consejo: 'Describe el tono y la forma de vender de tu negocio.',
      pestana: 'personalidad',
    },
    {
      id: 'reglas',
      titulo: 'Reglas del negocio',
      ok: !!d.reglas.trim(),
      puntos: 7,
      consejo: 'Escribe lo que tu vendedor SIEMPRE y NUNCA debe hacer.',
      pestana: 'personalidad',
    },
    {
      id: 'saludo',
      titulo: 'Saludo de bienvenida',
      ok: d.saludo,
      puntos: 5,
      consejo: 'Escribe cómo saluda tu vendedor, o arma el menú de bienvenida.',
      pestana: 'personalidad',
    },
    {
      id: 'conocimiento',
      titulo: 'Lo que sabe de tu negocio',
      ok: d.temasConocimiento >= TEMAS_MINIMOS || d.largoContexto >= CONTEXTO_MINIMO,
      puntos: 10,
      consejo: `Agrega al menos ${TEMAS_MINIMOS} temas (horarios, garantía, devoluciones…) para que responda con precisión.`,
      pestana: 'conocimiento',
    },
    {
      id: 'documentos',
      titulo: 'Documentos de entrenamiento',
      ok: d.documentosIndexados > 0,
      puntos: 5,
      consejo: 'Sube un PDF o una página con tu información (catálogo, políticas).',
      pestana: 'conocimiento',
    },
    {
      id: 'envios',
      titulo: 'Zonas y costos de envío',
      ok: d.zonasEnvio > 0,
      puntos: 10,
      consejo: 'Configura tus zonas de envío: sin ellas la IA no puede cotizar la entrega.',
      pestana: 'entrega',
    },
    {
      id: 'pagos',
      titulo: 'Medios de pago',
      ok: d.mediosPago > 0,
      puntos: 8,
      consejo: 'Agrega cómo te pagan (Yape, transferencia…) con el titular.',
      pestana: 'pagos',
    },
    {
      id: 'derivacion',
      titulo: 'Mensaje al pasar a una persona',
      ok: !!d.mensajeDerivacion.trim(),
      puntos: 7,
      consejo: 'Escribe qué le dice tu vendedor al cliente cuando lo pasa con tu equipo.',
      pestana: 'personalidad',
    },
  ];
  const puntaje = items.reduce((s, i) => s + (i.ok ? i.puntos : 0), 0);
  return {
    puntaje,
    nivel: puntaje >= 80 ? 'LISTO' : puntaje >= 50 ? 'CASI' : 'FALTA',
    // Primero lo que falta, y de eso lo que más suma.
    items: [...items].sort((a, b) => Number(a.ok) - Number(b.ok) || b.puntos - a.puntos),
  };
}
