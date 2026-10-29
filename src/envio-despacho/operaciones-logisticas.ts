/**
 * Operaciones logísticas del día (Panel de Ventas): picking, packing y las
 * plantillas de carga masiva de cada courier.
 *
 * Pedido de HELOU SHOP (29-10): su sistema anterior sacaba del mismo listado
 * de envíos el picking y el packing en PDF, y un Excel por courier para
 * cargarlo en el portal de cada uno. Acá vive la parte que no depende de la
 * base: cómo se traduce un envío a la fila que pide cada courier.
 */

export interface OperacionItem {
  codigo: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  imagenUrl: string | null;
}

export interface OperacionEnvio {
  comprobanteId: number;
  referencia: string;
  fechaEmision: string;
  fechaEnvio: string;
  estado: string;
  courier: string;
  courierLabel: string;
  tipoEnvio: string;
  nombre: string;
  dni: string;
  telefono: string;
  agencia: string;
  distrito: string;
  direccion: string;
  coordenadas: string;
  montoCobrar: number;
  totalVenta: number;
  formaPago: string;
  tipoVenta: string;
  empaquetador: string;
  repartidor: string;
  observaciones: string;
  turno: string;
  nroPaquetes: number;
  tamano: string;
  revisarProducto: boolean;
  sede: string;
  faltan: string[];
  items: OperacionItem[];
}

export type FormatoOperacion = 'DINSIDES' | 'EVA' | 'SHALOM' | 'GENERAL';

const sinTildes = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Distritos tal como los lista Eva Courier (hoja DITRITOS de su plantilla). */
export const DISTRITOS_EVA = [
  'ANCON', 'ATE', 'BARRANCO', 'BELLAVISTA', 'BREÑA', 'CAJAMARQUILLA', 'CALLAO', 'CARABAYLLO',
  'CARAPONGO', 'CARMEN DE LA LEGUA REYNOSO', 'CERCADO DE LIMA', 'CHACLACAYO', 'CHORRILLOS',
  'CHOSICA', 'CIENEGUILLA', 'COMAS', 'EL AGUSTINO', 'HUACHIPA', 'HUAYCAN', 'INDEPENDENCIA',
  'JESUS MARIA', 'JICAMARCA', 'LA MOLINA', 'LA PERLA', 'LA PUNTA', 'LA VICTORIA', 'LINCE',
  'LOS OLIVOS', 'LURIGANCHO', 'LURIN', 'MAGDALENA DEL MAR', 'MANCHAY', 'MARQUEZ - CALLAO',
  'MI PERÚ', 'MIRAFLORES', 'PACHACÁMAC', 'PUEBLO LIBRE', 'PUENTE PIEDRA', 'PUNTA NEGRA',
  'RICARDO PALMA', 'RIMAC', 'SALAMANCA ATE', 'SAN BORJA', 'SAN ISIDRO', 'SAN JUAN DE LURIGANCHO',
  'SAN JUAN DE MIRAFLORES', 'SAN LUIS', 'SAN MARTIN DE PORRES', 'SAN MIGUEL', 'SANTA ANITA',
  'SANTA CLARA - ATE', 'SANTA EULALIA', 'SANTA MARIA DEL MAR', 'SANTA ROSA', 'SANTIAGO DE SURCO',
  'SURQUILLO', 'VENTANILLA', 'VILLA EL SALVADOR', 'VILLA MARIA DEL TRIUNFO',
];

const ALIAS_EVA: Record<string, string> = {
  LIMA: 'CERCADO DE LIMA',
  'LIMA CERCADO': 'CERCADO DE LIMA',
  SURCO: 'SANTIAGO DE SURCO',
  SJL: 'SAN JUAN DE LURIGANCHO',
  SJM: 'SAN JUAN DE MIRAFLORES',
  SMP: 'SAN MARTIN DE PORRES',
  VES: 'VILLA EL SALVADOR',
  VMT: 'VILLA MARIA DEL TRIUNFO',
  MAGDALENA: 'MAGDALENA DEL MAR',
  'ATE VITARTE': 'ATE',
  'ATE-VITARTE': 'ATE',
  'CARMEN DE LA LEGUA': 'CARMEN DE LA LEGUA REYNOSO',
};

/**
 * El distrito en la forma exacta del listado de Eva: su plantilla calcula la
 * tarifa por esa celda y un nombre que no calza queda sin tarifa. Un envío a
 * provincia va como "PROVINCIA SHALOM"/"PROVINCIA OLVA" según el courier.
 */
export function distritoEva(distrito: string, courier = ''): string {
  const c = courier.toUpperCase();
  const base = sinTildes(String(distrito || '').toUpperCase()).replace(/\s+/g, ' ').trim();
  if (!base) {
    if (c.includes('SHALOM')) return 'PROVINCIA SHALOM';
    if (c.includes('OLVA')) return 'PROVINCIA OLVA';
    return '';
  }
  const alias = ALIAS_EVA[base];
  if (alias) return alias;
  const exacto = DISTRITOS_EVA.find((d) => sinTildes(d) === base);
  return exacto ?? String(distrito).toUpperCase().trim();
}

/** Cómo cobra Eva, en sus palabras (columna MÉTODO DE COBRANZA). */
export function metodoCobroEva(e: Pick<OperacionEnvio, 'montoCobrar' | 'formaPago' | 'tipoVenta'>): string {
  const tipo = (e.tipoVenta || '').toUpperCase();
  if (tipo.includes('CAMBIO')) return 'CAMBIO / CAMBIO CON COBRO';
  if (tipo === 'RECOJO') return 'RECOJO EN RUTA';
  if (!(e.montoCobrar > 0)) return 'SOLO ENTREGAR';
  const f = (e.formaPago || '').toUpperCase();
  if (f.includes('POS')) return 'POS';
  if (/YAPE|PLIN|TRANSFER/.test(f)) return 'TRANSFERENCIA / YAPE';
  return 'EFECTIVO';
}

const detalleProductos = (items: OperacionItem[]) =>
  items.map((i) => `${cantidadTxt(i.cantidad)} ${i.descripcion}`.trim()).join('\n');

export const cantidadTxt = (n: number) => (Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(2));

export function filaEva(e: OperacionEnvio): Record<string, string | number> {
  return {
    '(opcional) CÓDIGO PEDIDO': e.referencia,
    'DESTINATARIO / QUIEN RECIBE EL PRODUCTO': e.nombre,
    'CELULAR DE CONTÁCTO QUIEN RECIBE EL PRODUCTO': e.telefono,
    'DISTRITO ENTREGA': distritoEva(e.distrito, e.courier),
    'DIRECCIÓN': e.direccion,
    'REFERENCIA (Como llegar al punto de destino - Opcional)': '',
    'LINK MAPS O COORDENADAS GPS': e.coordenadas,
    'MÉTODO DE COBRANZA (Metodo como se recaudara el cobro de su producto)': metodoCobroEva(e),
    'IMPORTE A COBRAR (S/.)': Number(e.montoCobrar.toFixed(2)),
    'OBSERVACIONES DE ENTREGA (indicar si habra algun mensaje para su cliente)': e.observaciones,
    'DESCRIPCION DEL PRODUCTO (especifique el nombre de producto a entregar)': detalleProductos(e.items),
    'PAQUETES O PROMOCIONES / CANTIDAD': e.nroPaquetes || 1,
    '(opcional) COLOR': '',
    'SKU (Código del Producto o Paquete en el almacen en EVA COURIER - Opcional)': '',
  };
}

/** Tamaño de Shalom → texto de su columna MERCADERIA ("PAQUETE XS"). */
const mercaderiaShalom = (tamano: string) => {
  const t = (tamano || '').toUpperCase().trim();
  if (!t) return '';
  return t === 'SOBRE' ? 'SOBRE' : `PAQUETE ${t}`;
};

export function filaShalom(e: OperacionEnvio, origen: string): Record<string, string | number> {
  return {
    'DESTINATARIO (DOC)': e.dni,
    'TELF. DESTINATARIO': e.telefono,
    'CONTACTO (DOC)': '',
    'TELF. CONTACTO': '',
    'NRO GRR': '',
    ORIGEN: origen,
    DESTINO: e.agencia || e.direccion,
    MERCADERIA: mercaderiaShalom(e.tamano),
    ALTO: 0,
    ANCHO: 0,
    LARGO: 0,
    PESO: 0,
    CANTIDAD: e.nroPaquetes || 1,
  };
}

export function filaGeneral(e: OperacionEnvio): Record<string, string | number> {
  return {
    PEDIDO: e.referencia,
    'FECHA DE ENVÍO': e.fechaEnvio,
    ESTADO: e.estado,
    COURIER: e.courierLabel,
    DESTINATARIO: e.nombre,
    DNI: e.dni,
    CELULAR: e.telefono,
    'AGENCIA / DISTRITO': e.agencia || e.distrito,
    DIRECCIÓN: e.direccion,
    PRODUCTOS: detalleProductos(e.items),
    UNIDADES: e.items.reduce((s, i) => s + Number(i.cantidad || 0), 0),
    'N° PAQUETES': e.nroPaquetes || 1,
    'TOTAL VENTA': Number(e.totalVenta.toFixed(2)),
    'POR COBRAR': Number(e.montoCobrar.toFixed(2)),
    'FORMA DE PAGO': e.formaPago,
    EMPAQUETADOR: e.empaquetador,
    REPARTIDOR: e.repartidor,
    TURNO: e.turno,
    SEDE: e.sede,
    OBSERVACIONES: e.observaciones,
    '✔ DATOS': e.faltan.length ? `Faltan: ${e.faltan.join(', ')}` : 'Completo',
  };
}

/** Productos del día sumados (hoja de picking del Excel general). */
export function consolidarProductos(envios: OperacionEnvio[]) {
  const mapa = new Map<string, { codigo: string; descripcion: string; total: number; pedidos: string[] }>();
  for (const e of envios) {
    for (const i of e.items) {
      const clave = `${i.codigo}|${i.descripcion}`;
      const fila = mapa.get(clave) ?? { codigo: i.codigo, descripcion: i.descripcion, total: 0, pedidos: [] };
      fila.total += Number(i.cantidad || 0);
      if (!fila.pedidos.includes(e.referencia)) fila.pedidos.push(e.referencia);
      mapa.set(clave, fila);
    }
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total || a.descripcion.localeCompare(b.descripcion));
}
