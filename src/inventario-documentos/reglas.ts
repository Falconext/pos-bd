/**
 * Entradas y salidas de mercadería en un solo documento.
 *
 * Pedido de un cliente (2026-10-22): su sistema anterior tenía Inventario →
 * Entradas / Salidas, y ahí agregaba el producto, ponía la cantidad y seguía
 * añadiendo. En Krezka cada ajuste era de un producto a la vez —abrir, ajustar,
 * cerrar— y con veinte productos eran veinte veces lo mismo.
 *
 * Acá vive lo que no toca la base: qué motivos hay, cómo se lee lo que manda
 * la pantalla y qué se le contesta cuando algo no cuadra. Los mensajes van en
 * palabras del empresario: los lee el que está cargando la mercadería, no un
 * programador.
 */
import { etiquetaDeMotivo } from '../producto/motivo-ajuste-stock';

export type TipoDocumento = 'ENTRADA' | 'SALIDA';

/** Por qué ENTRA mercadería sin haberse comprado. */
export const MOTIVOS_ENTRADA = [
  'INVENTARIO_INICIAL',
  'DEVOLUCION_CLIENTE',
  'BONIFICACION',
  'PRODUCCION',
  'ENCONTRADO',
  'CONTEO',
  'ERROR_REGISTRO',
  'OTRO',
] as const;

/** Por qué SALE mercadería sin haberse vendido. */
export const MOTIVOS_SALIDA = [
  'MERMA',
  'VENCIDO',
  'CONSUMO_INTERNO',
  'MUESTRA',
  'DONACION',
  'PERDIDA',
  'DEVOLUCION_PROVEEDOR',
  'CONTEO',
  'ERROR_REGISTRO',
  'OTRO',
] as const;

export const motivosDe = (tipo: TipoDocumento): readonly string[] =>
  tipo === 'ENTRADA' ? MOTIVOS_ENTRADA : MOTIVOS_SALIDA;

/** Tope de líneas: una carga de inventario inicial grande va por Excel. */
export const MAX_LINEAS = 300;

/** NE-000001 / NS-000001: lo que se ve en pantalla y en el papel. */
export const numeroVisible = (tipo: TipoDocumento, numero: number): string =>
  `${tipo === 'ENTRADA' ? 'NE' : 'NS'}-${String(numero).padStart(6, '0')}`;

/**
 * Lo que queda en el kardex. El motivo va adelante y separado con " · ",
 * igual que el ajuste desde la ficha del producto: así el reporte de Mermas
 * reconoce una salida por merma o vencido venga de donde venga.
 */
export const conceptoKardex = (tipo: TipoDocumento, motivo: string, numero: number): string =>
  `${etiquetaDeMotivo(motivo)} · ${tipo === 'ENTRADA' ? 'Entrada' : 'Salida'} ${numeroVisible(tipo, numero)}`;

export interface LineaDocumento {
  productoId: number;
  cantidad: number;
  costoUnitario?: number;
  lote?: string;
  /** YYYY-MM-DD: solo hace falta cuando el lote es nuevo. */
  vence?: string;
}

export interface DocumentoLeido {
  tipo: TipoDocumento;
  motivo: string;
  detalle?: string;
  lineas: LineaDocumento[];
}

/** Un problema de una línea concreta: la pantalla lo pinta en esa fila. */
export interface ProblemaLinea {
  linea: number;
  productoId?: number;
  mensaje: string;
}

export class DocumentoInvalido extends Error {
  constructor(
    message: string,
    readonly problemas: ProblemaLinea[] = [],
  ) {
    super(message);
  }
}

const redondear3 = (n: number) => Math.round(n * 1000) / 1000;

const esFecha = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

/**
 * Lee lo que manda la pantalla. Junta todos los problemas de las líneas en
 * un solo error: que el usuario corrija tres filas de una vez y no una por
 * intento.
 */
export const leerDocumento = (body: any): DocumentoLeido => {
  const tipo = String(body?.tipo ?? '').toUpperCase();
  if (tipo !== 'ENTRADA' && tipo !== 'SALIDA') {
    throw new DocumentoInvalido('Indica si es una entrada o una salida.');
  }
  const motivo = String(body?.motivo ?? '').trim().toUpperCase();
  if (!motivo) throw new DocumentoInvalido('Elige el motivo.');
  if (!motivosDe(tipo).includes(motivo)) {
    throw new DocumentoInvalido(`"${motivo}" no es un motivo de ${tipo === 'ENTRADA' ? 'entrada' : 'salida'}.`);
  }
  const detalle = String(body?.detalle ?? '').trim().slice(0, 500) || undefined;
  if (motivo === 'OTRO' && !detalle) {
    throw new DocumentoInvalido('Con "Otro motivo" escribe en el detalle qué pasó.');
  }

  const crudas = Array.isArray(body?.items) ? body.items : [];
  if (!crudas.length) throw new DocumentoInvalido('Agrega al menos un producto.');
  if (crudas.length > MAX_LINEAS) {
    throw new DocumentoInvalido(`Son ${crudas.length} productos; el máximo por documento es ${MAX_LINEAS}. Divídelo en dos.`);
  }

  const problemas: ProblemaLinea[] = [];
  const vistos = new Set<string>();
  const lineas: LineaDocumento[] = crudas.map((it: any, i: number) => {
    const n = i + 1;
    const productoId = Number(it?.productoId);
    const cantidad = Number(it?.cantidad);
    if (!Number.isInteger(productoId) || productoId <= 0) {
      problemas.push({ linea: n, mensaje: 'Falta el producto.' });
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      problemas.push({ linea: n, productoId, mensaje: 'La cantidad tiene que ser mayor que cero.' });
    } else if (redondear3(cantidad) !== cantidad) {
      problemas.push({ linea: n, productoId, mensaje: 'La cantidad admite hasta 3 decimales.' });
    }

    let costoUnitario: number | undefined;
    if (it?.costoUnitario !== undefined && it?.costoUnitario !== null && it?.costoUnitario !== '') {
      costoUnitario = Number(it.costoUnitario);
      if (tipo === 'SALIDA') {
        // La salida se valoriza al costo que ya tiene el producto: dejar
        // escribir otro sería inventar cuánto se perdió.
        costoUnitario = undefined;
      } else if (!Number.isFinite(costoUnitario) || costoUnitario < 0) {
        problemas.push({ linea: n, productoId, mensaje: 'El costo no puede ser negativo.' });
      }
    }

    const lote = String(it?.lote ?? '').trim().toUpperCase().slice(0, 60) || undefined;
    const vence = String(it?.vence ?? '').trim() || undefined;
    if (vence && !esFecha(vence)) {
      problemas.push({ linea: n, productoId, mensaje: 'La fecha de vencimiento no es válida.' });
    }

    const clave = `${productoId}|${lote ?? ''}`;
    if (vistos.has(clave)) {
      problemas.push({
        linea: n,
        productoId,
        mensaje: lote ? `El lote ${lote} de este producto ya está en otra fila: suma las cantidades.` : 'Este producto ya está en otra fila: suma las cantidades.',
      });
    }
    vistos.add(clave);

    return { productoId, cantidad, costoUnitario, lote, vence };
  });

  if (problemas.length) {
    throw new DocumentoInvalido(
      problemas.length === 1 ? `Fila ${problemas[0].linea}: ${problemas[0].mensaje}` : `Hay ${problemas.length} filas por corregir.`,
      problemas,
    );
  }
  return { tipo, motivo, detalle, lineas };
};

/**
 * Farmacia, botica y droguería trabajan siempre con lote y vencimiento
 * (DIGEMID). Fabricación los usa en insumos, pero no en todo: ahí son
 * opcionales. Misma regla que la API (`erp.service.contextoNegocio`).
 */
export const loteObligatorioPara = (rubro: string) => /farmac|botica|droguer|medicament/i.test(rubro);
