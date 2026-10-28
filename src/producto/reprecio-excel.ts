import * as XLSX from 'xlsx';

/**
 * Reprecio del Kardex con Excel. Dos formatos, los mismos que ya manejan los
 * empresarios que vienen de otro sistema:
 *
 * - PRECIO:   `Código | Precio` → nuevo precio normal del producto.
 * - VOLUMEN:  `Código | RangoInicial1 | RangoFinal1 | Precio1 | RangoInicial2 …`
 *             → precios por cantidad (mayorista). Los tramos se repiten las
 *             veces que haga falta.
 *
 * Todo lo de este archivo es puro (sin base): leer y validar se prueba aparte,
 * y previsualizar y aplicar usan exactamente lo mismo.
 */

export type TipoReprecioExcel = 'PRECIO' | 'VOLUMEN';

export interface Tramo {
  desde: number;
  hasta: number | null;
  precio: number;
}

export interface FilaExcel {
  /** Número de fila en la hoja (la cabecera es la 1). */
  fila: number;
  codigo: string;
  precio?: number | null;
  /** Texto original cuando el precio no es un número válido. */
  precioInvalido?: string;
  tramos?: Tramo[];
  errorTramos?: string;
}

export interface LecturaExcel {
  tipo: TipoReprecioExcel;
  filas: FilaExcel[];
}

const normalizar = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const vacio = (v: unknown) =>
  v === null || v === undefined || String(v).trim() === '';

/** "12,50" y "S/ 12.50" también valen: así lo escriben a mano. */
export function aNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v ?? '')
    .replace(/s\/|\s/gi, '')
    .replace(',', '.');
  if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/**
 * Los tramos de una fila, validados. Reglas:
 * - Un tramo vacío (las tres celdas en blanco) no cuenta.
 * - "Desde" es un entero ≥ 1 y el precio es mayor que 0.
 * - "Hasta" puede quedar vacío solo en el último tramo ("en adelante").
 * - Los tramos van en orden y no se pisan.
 */
export function validarTramos(
  tramos: { desde: unknown; hasta: unknown; precio: unknown }[],
): {
  tramos: Tramo[];
  error?: string;
} {
  const llenos = tramos.filter(
    (t) => !(vacio(t.desde) && vacio(t.hasta) && vacio(t.precio)),
  );
  const out: Tramo[] = [];
  for (let i = 0; i < llenos.length; i++) {
    const n = i + 1;
    const desde = aNumero(llenos[i].desde);
    const hasta = vacio(llenos[i].hasta) ? null : aNumero(llenos[i].hasta);
    const precio = aNumero(llenos[i].precio);
    if (desde === null || !Number.isInteger(desde) || desde < 1) {
      return {
        tramos: [],
        error: `Tramo ${n}: el rango inicial debe ser un número entero desde 1`,
      };
    }
    if (
      !vacio(llenos[i].hasta) &&
      (hasta === null || !Number.isInteger(hasta))
    ) {
      return {
        tramos: [],
        error: `Tramo ${n}: el rango final debe ser un número entero`,
      };
    }
    if (hasta !== null && hasta < desde) {
      return {
        tramos: [],
        error: `Tramo ${n}: el rango final (${hasta}) es menor que el inicial (${desde})`,
      };
    }
    if (precio === null || precio <= 0) {
      return {
        tramos: [],
        error: `Tramo ${n}: falta el precio o no es mayor que 0`,
      };
    }
    out.push({ desde, hasta, precio });
  }
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    if (prev.hasta === null) {
      return {
        tramos: [],
        error: `Tramo ${i}: sin rango final solo puede ir el último tramo`,
      };
    }
    if (out[i].desde <= prev.hasta) {
      return {
        tramos: [],
        error: `Tramo ${i + 1}: empieza en ${out[i].desde} pero el tramo anterior llega hasta ${prev.hasta}`,
      };
    }
  }
  return { tramos: out };
}

/**
 * Lo que queda guardado en el producto: el tramo que empieza en 1 es el precio
 * normal (se vende así desde la primera unidad) y el resto son precios por
 * cantidad mínima, que es como Krezka guarda el mayorista.
 */
export function tramosAPrecios(tramos: Tramo[]): {
  precioBase: number | null;
  mayorista: { cantidadMinima: number; precio: number }[];
} {
  const base = tramos.find((t) => t.desde === 1);
  return {
    precioBase: base ? base.precio : null,
    mayorista: tramos
      .filter((t) => t.desde > 1)
      .map((t) => ({ cantidadMinima: t.desde, precio: t.precio })),
  };
}

/** Lee la primera hoja. Detecta el formato por la cabecera. */
export function leerExcelReprecio(buffer: Buffer): LecturaExcel {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  if (!hoja) throw new Error('El archivo no tiene hojas');
  const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, {
    header: 1,
    defval: '',
    raw: true,
  });
  const cab = (filas[0] || []).map(normalizar);
  const colCodigo = cab.findIndex(
    (c) => c === 'codigo' || c === 'sku' || c === 'codigodebarras',
  );
  if (colCodigo < 0) {
    throw new Error('Falta la columna "Código" en la primera fila');
  }

  // Tramos: RangoInicialN / RangoFinalN / PrecioN.
  const tramosCols: {
    n: number;
    desde: number;
    hasta: number;
    precio: number;
  }[] = [];
  cab.forEach((c, i) => {
    const m = c.match(/^rangoinicial(\d+)$/);
    if (!m) return;
    const n = m[1];
    tramosCols.push({
      n: Number(n),
      desde: i,
      hasta: cab.indexOf(`rangofinal${n}`),
      precio: cab.indexOf(`precio${n}`),
    });
  });
  tramosCols.sort((a, b) => a.n - b.n);

  const datos = filas.slice(1);
  const enUso = (r: unknown[]) => r.some((v) => !vacio(v));

  if (tramosCols.length > 0) {
    const faltan = tramosCols.find((t) => t.precio < 0);
    if (faltan)
      throw new Error(
        `Falta la columna "Precio${faltan.n}" para el tramo ${faltan.n}`,
      );
    return {
      tipo: 'VOLUMEN',
      filas: datos
        .map((r, i) => ({ r, fila: i + 2 }))
        .filter(({ r }) => enUso(r))
        .map(({ r, fila }) => {
          const v = validarTramos(
            tramosCols.map((t) => ({
              desde: r[t.desde],
              hasta: t.hasta >= 0 ? r[t.hasta] : '',
              precio: r[t.precio],
            })),
          );
          return {
            fila,
            codigo: String(r[colCodigo] ?? '').trim(),
            tramos: v.tramos,
            ...(v.error ? { errorTramos: v.error } : {}),
          };
        }),
    };
  }

  const colPrecio = cab.findIndex(
    (c) => c === 'precio' || c === 'precioventa' || c === 'precionuevo',
  );
  if (colPrecio < 0) {
    throw new Error(
      'Falta la columna "Precio" (o "RangoInicial1…" para precios por volumen)',
    );
  }
  return {
    tipo: 'PRECIO',
    filas: datos
      .map((r, i) => ({ r, fila: i + 2 }))
      .filter(({ r }) => enUso(r))
      .map(({ r, fila }) => {
        const precio = aNumero(r[colPrecio]);
        return {
          fila,
          codigo: String(r[colCodigo] ?? '').trim(),
          precio,
          ...(precio === null
            ? { precioInvalido: String(r[colPrecio] ?? '') }
            : {}),
        };
      }),
  };
}

/** Plantilla descargable con el mismo formato que se importa. */
export function plantillaReprecio(tipo: TipoReprecioExcel): Buffer {
  const filas =
    tipo === 'VOLUMEN'
      ? [
          [
            'Código',
            'RangoInicial1',
            'RangoFinal1',
            'Precio1',
            'RangoInicial2',
            'RangoFinal2',
            'Precio2',
            'RangoInicial3',
            'RangoFinal3',
            'Precio3',
          ],
          ['PROD-001', 1, 5, 10, 6, 11, 9, 12, '', 8],
          ['PROD-002', 1, 11, 25, 12, '', 22, '', '', ''],
        ]
      : [
          ['Código', 'Precio'],
          ['PROD-001', 12.5],
          ['PROD-002', 8.9],
        ];
  return hojaABuffer(
    filas,
    tipo === 'VOLUMEN' ? 'Precios por volumen' : 'Precios',
  );
}

export function hojaABuffer(filas: unknown[][], nombre: string): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(filas),
    nombre.slice(0, 31),
  );
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * Respaldo con los precios de ANTES en el mismo formato: si algo salió mal, se
 * vuelve a subir este archivo y todo queda como estaba.
 */
export function respaldoReprecio(
  tipo: TipoReprecioExcel,
  productos: {
    codigo: string;
    precio: number;
    mayorista: { cantidadMinima: number; precio: number }[];
  }[],
): Buffer {
  if (tipo === 'PRECIO') {
    return hojaABuffer(
      [['Código', 'Precio'], ...productos.map((p) => [p.codigo, p.precio])],
      'Respaldo precios',
    );
  }
  const maxTramos = Math.max(
    1,
    ...productos.map((p) => p.mayorista.length + 1),
  );
  const cab: string[] = ['Código'];
  for (let n = 1; n <= maxTramos; n++)
    cab.push(`RangoInicial${n}`, `RangoFinal${n}`, `Precio${n}`);
  const filas = productos.map((p) => {
    const escalones = [...p.mayorista].sort(
      (a, b) => a.cantidadMinima - b.cantidadMinima,
    );
    const tramos: (string | number)[] = [];
    const desdes = [1, ...escalones.map((e) => e.cantidadMinima)];
    const precios = [p.precio, ...escalones.map((e) => e.precio)];
    desdes.forEach((d, i) => {
      const siguiente = desdes[i + 1];
      tramos.push(d, siguiente ? siguiente - 1 : '', precios[i]);
    });
    return [p.codigo, ...tramos];
  });
  return hojaABuffer([cab, ...filas], 'Respaldo por volumen');
}
