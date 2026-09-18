import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { ComprasService } from './compras.service';
import { ClienteService } from '../cliente/cliente.service';
import { ProductoService } from '../producto/producto.service';
import { CrearCompraDto } from './dto/crear-compra.dto';

/**
 * Importación masiva de COMPRAS desde Excel.
 *
 * Pensada para el empresario que ya tiene su compra en una hoja (p. ej. la
 * lista de un mayorista o un contenedor importado) con producto, cantidad,
 * costo y a qué sede/almacén va cada cosa, y no quiere tipearla línea por
 * línea en "Nueva compra".
 *
 * Formato: UNA fila por producto. La plantilla se descarga ya precargada con
 * el catálogo de la empresa (código, código de barras, descripción y stock por
 * sede) para que el usuario solo llene CANTIDAD, COSTO y SEDE; las filas sin
 * cantidad se ignoran. Las filas se agrupan en compras por
 * PROVEEDOR + SERIE + NÚMERO + SEDE: un solo Excel puede cargar la compra de
 * varias sedes (una compra por sede) o varias facturas de proveedores
 * distintos. Si una fila no trae datos del comprobante se crea una compra
 * "SIN COMPROBANTE" (serie IMP, número automático) contra el proveedor
 * genérico "IMPORTACIÓN EXCEL".
 *
 * Cada compra se crea con el `ComprasService.crear` normal: kardex, costo
 * promedio, lotes/FEFO, cuentas por pagar y aprobación se comportan igual que
 * una compra manual. Primero se PREVISUALIZA (nada se guarda) y luego se
 * IMPORTA; ambas usan el mismo parseo, así que lo que muestra la vista previa
 * es exactamente lo que se va a grabar.
 */

export type EstadoLinea = 'OK' | 'AVISO' | 'ERROR';

export interface LineaImport {
  fila: number;
  /** Sede/almacén al que entra esta línea (distribución por sede). */
  sedeId: number | null;
  sedeNombre: string;
  codigo: string;
  descripcion: string;
  productoId: number | null;
  productoNombre: string | null;
  /** Se creará al importar (no existía y `crearProductos` está activo). */
  productoNuevo: boolean;
  cantidad: number;
  costoUnitario: number;
  incluyeIgv: boolean;
  lote?: string;
  fechaVencimiento?: string;
  subtotal: number;
  total: number;
  estado: EstadoLinea;
  mensajes: string[];
}

export interface CompraImport {
  clave: string;
  /** Sede de la cabecera (la de la primera línea). */
  sedeId: number | null;
  sedeNombre: string;
  /** Nombres de todas las sedes que reciben líneas (distribución). */
  sedesNombres: string[];
  proveedorRuc: string;
  proveedorNombre: string;
  proveedorExiste: boolean;
  tipoDoc: string;
  serie: string;
  numero: string;
  /** true = serie/número asignados por el sistema (fila sin comprobante). */
  sinComprobante: boolean;
  fechaEmision: string;
  moneda: string;
  tipoCambio?: number;
  observaciones?: string;
  lineas: LineaImport[];
  subtotal: number;
  igv: number;
  total: number;
  estado: EstadoLinea;
  errores: string[];
}

export interface OpcionesImport {
  /** Si la columna INCLUYE IGV viene vacía: ¿el costo trae IGV? */
  incluyeIgvDefault: boolean;
  /** Crear en el catálogo los productos que no existan (necesita DESCRIPCIÓN). */
  crearProductos: boolean;
  /** Registrar la compra como pagada al importar (pago inicial = total). */
  marcarPagado: boolean;
  metodoPago?: string;
}

export interface PreviewImport {
  resumen: {
    filasLeidas: number;
    filasConCantidad: number;
    lineasOk: number;
    lineasAviso: number;
    lineasError: number;
    compras: number;
    comprasOk: number;
    comprasError: number;
    productosNuevos: number;
    totalGeneral: number;
  };
  sedes: { id: number; nombre: string }[];
  compras: CompraImport[];
  erroresGlobales: string[];
}

export interface ResultadoImport extends PreviewImport {
  importadas: {
    compraId: number;
    serie: string;
    numero: string;
    sedeNombre: string;
    total: number;
    avisosStock?: string[];
    /** true = la compra quedó pendiente de aprobación (el stock entra al aprobar). */
    pendienteAprobacion?: boolean;
  }[];
  fallidas: { clave: string; serie: string; numero: string; motivo: string }[];
}

const TIPOS_DOC_COMPRA = new Set([
  'FACTURA',
  'BOLETA',
  'NOTA DE VENTA',
  'NOTA_VENTA',
  'NV',
  'RECIBO',
  'SIN COMPROBANTE',
  'SIN_COMPROBANTE',
  'OTRO',
]);

const PROVEEDOR_GENERICO_RUC = '00000000000';
const PROVEEDOR_GENERICO_NOMBRE = 'IMPORTACIÓN EXCEL';
const SERIE_IMPORT = 'IMP';

@Injectable()
export class ImportarComprasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comprasService: ComprasService,
    private readonly clienteService: ClienteService,
    private readonly productoService: ProductoService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers de lectura
  // ───────────────────────────────────────────────────────────────────────────

  /** `Código de Barras` → `codigodebarras` (sin tildes, espacios ni símbolos). */
  private normalizarClave(k: string): string {
    return String(k ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  private normalizarTexto(v: any): string {
    return String(v ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ');
  }

  private pick(fila: Record<string, any>, claves: string[]): any {
    for (const c of claves) {
      const v = fila[c];
      if (v != null && String(v).trim() !== '') return v;
    }
    return null;
  }

  /**
   * Celda numérica. `null` = vacía; `NaN` = tiene algo pero no es un número
   * (para avisar en vez de ignorar la fila). Acepta "1,250.50", "1.250,50",
   * "S/ 12.5", "12,5". Una sola coma seguida de exactamente 3 dígitos se lee
   * como separador de miles ("1,250" = 1250), si no como decimal ("12,5").
   */
  private numero(v: any): number | null {
    if (v == null || String(v).trim() === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    let s = String(v)
      .trim()
      .replace(/[^\d.,-]/g, '');
    if (!s || !/\d/.test(s)) return NaN;
    if (s.includes(',') && s.includes('.')) {
      s =
        s.lastIndexOf(',') > s.lastIndexOf('.')
          ? s.replace(/\./g, '').replace(',', '.')
          : s.replace(/,/g, '');
    } else if (s.includes(',')) {
      s = /^-?\d{1,3}(,\d{3})+$/.test(s)
        ? s.replace(/,/g, '')
        : s.replace(',', '.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  private booleano(v: any, def: boolean): boolean {
    if (v == null || String(v).trim() === '') return def;
    const s = this.normalizarTexto(v);
    if (['si', 's', 'yes', 'y', 'true', '1', 'x'].includes(s)) return true;
    if (['no', 'n', 'false', '0'].includes(s)) return false;
    return def;
  }

  /** Acepta Date, serial de Excel, `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`. */
  private fechaISO(v: any): string | null {
    if (v == null || v === '') return null;
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      return v.toISOString().slice(0, 10);
    }
    if (typeof v === 'number') {
      const d = XLSX.SSF.parse_date_code(v);
      if (d) {
        return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      }
      return null;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  }

  private hoyISO(): string {
    // Fecha en hora Lima (el proceso corre con TZ=America/Lima).
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private r2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /** Lee la hoja de compras (la primera, o la llamada COMPRAS) con claves normalizadas. */
  private leerFilas(buffer: Buffer): {
    filas: Record<string, any>[];
    /** Índice (0-based) de la fila de encabezado, para numerar filas como en Excel. */
    offsetFila: number;
  } {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch {
      throw new BadRequestException(
        'No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) o CSV válido.',
      );
    }
    const nombreHoja =
      wb.SheetNames.find((n) => this.normalizarClave(n) === 'compras') ??
      wb.SheetNames[0];
    const sheet = nombreHoja ? wb.Sheets[nombreHoja] : undefined;
    if (!sheet) throw new BadRequestException('El archivo no tiene hojas.');
    // Validar que sea la plantilla (o algo compatible): un archivo cualquiera
    // (texto, PDF renombrado…) XLSX lo "lee" como CSV vacío y pasaría en
    // silencio como "0 filas". El encabezado puede no estar en la fila 1 (el
    // usuario suele poner un título o filas vacías arriba): se busca en las
    // primeras 15 filas la que tenga CANTIDAD y una columna de producto.
    const COLS_CANTIDAD = ['cantidad', 'cant', 'qty', 'unidades'];
    const COLS_PRODUCTO = [
      'codigo',
      'sku',
      'codigoproducto',
      'productocodigo',
      'codigodebarras',
      'codigobarras',
      'ean',
      'barras',
      'descripcion',
      'producto',
      'nombre',
    ];
    const primeras = XLSX.utils.sheet_to_json<any[]>(sheet, {
      header: 1,
      range: 0,
      defval: null,
    });
    let filaEncabezado = -1;
    for (let i = 0; i < Math.min(primeras.length, 15); i++) {
      const hs = (primeras[i] ?? []).map((h) =>
        this.normalizarClave(String(h ?? '')),
      );
      if (
        hs.some(
          (h) =>
            COLS_CANTIDAD.includes(h) ||
            // Columna de cantidad por sede: "CANT. SEDE SURCO" → "cantsedesurco"
            /^cant(idad)?[a-z0-9]+$/.test(h),
        ) &&
        hs.some((h) => COLS_PRODUCTO.includes(h))
      ) {
        filaEncabezado = i;
        break;
      }
    }
    if (filaEncabezado < 0) {
      throw new BadRequestException(
        'El archivo no tiene las columnas de la plantilla (se necesitan al menos CÓDIGO o DESCRIPCIÓN y CANTIDAD). Descarga la plantilla y úsala como base.',
      );
    }
    const filas = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
      defval: null,
      raw: true,
      range: filaEncabezado,
    });
    return {
      offsetFila: filaEncabezado,
      filas: filas.map((f) => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(f)) {
          out[this.normalizarClave(k)] = typeof v === 'string' ? v.trim() : v;
        }
        return out;
      }),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Índices: productos, sedes, proveedores
  // ───────────────────────────────────────────────────────────────────────────

  private async construirIndiceProductos(empresaId: number) {
    const productos = await this.prisma.producto.findMany({
      where: { empresaId, estado: 'ACTIVO' as any },
      select: {
        id: true,
        codigo: true,
        codigoBarras: true,
        descripcion: true,
        tipoAfectacionIGV: true,
        codigosBarras: {
          select: {
            codigo: true,
            codigoInterno: true,
            unidadesPorPaquete: true,
          },
        },
      },
    });
    const porCodigo = new Map<string, number>();
    const porBarras = new Map<string, { id: number; unidades: number }>();
    const porDescripcion = new Map<string, number[]>();
    const nombres = new Map<number, string>();
    // Afectación IGV: exonerados (20) / inafectos (30) entran sin IGV.
    const gravado = new Map<number, boolean>();
    for (const p of productos) {
      nombres.set(p.id, p.descripcion);
      const afe = String(p.tipoAfectacionIGV ?? '10').trim();
      gravado.set(p.id, afe === '' || afe.startsWith('1'));
      if (p.codigo) porCodigo.set(this.normalizarTexto(p.codigo), p.id);
      if (p.codigoBarras) {
        porBarras.set(this.normalizarTexto(p.codigoBarras), {
          id: p.id,
          unidades: 1,
        });
      }
      for (const alt of p.codigosBarras ?? []) {
        const u = Number(alt.unidadesPorPaquete) || 1;
        if (alt.codigo)
          porBarras.set(this.normalizarTexto(alt.codigo), {
            id: p.id,
            unidades: u,
          });
        if (alt.codigoInterno)
          porBarras.set(this.normalizarTexto(alt.codigoInterno), {
            id: p.id,
            unidades: u,
          });
      }
      const d = this.normalizarTexto(p.descripcion);
      if (d) porDescripcion.set(d, [...(porDescripcion.get(d) ?? []), p.id]);
    }
    return { porCodigo, porBarras, porDescripcion, nombres, gravado };
  }

  /**
   * Resuelve el producto de una fila. Orden: CÓDIGO (SKU) → CÓDIGO DE BARRAS
   * (principal o alterno; los de paquete multiplican la cantidad) → DESCRIPCIÓN
   * exacta normalizada (solo si coincide con UN producto).
   */
  private resolverProducto(
    idx: Awaited<
      ReturnType<ImportarComprasService['construirIndiceProductos']>
    >,
    codigo: string,
    barras: string,
    descripcion: string,
  ): { id: number; unidades: number; via: string } | { error: string } {
    const cod = this.normalizarTexto(codigo);
    const ean = this.normalizarTexto(barras);
    const desc = this.normalizarTexto(descripcion);
    if (cod) {
      const id = idx.porCodigo.get(cod);
      if (id) return { id, unidades: 1, via: 'código' };
      const b = idx.porBarras.get(cod);
      if (b) return { ...b, via: 'código de barras' };
    }
    if (ean) {
      const b = idx.porBarras.get(ean);
      if (b) return { ...b, via: 'código de barras' };
      const id = idx.porCodigo.get(ean);
      if (id) return { id, unidades: 1, via: 'código' };
    }
    if (desc) {
      const ids = idx.porDescripcion.get(desc) ?? [];
      if (ids.length === 1)
        return { id: ids[0], unidades: 1, via: 'descripción' };
      if (ids.length > 1) {
        return {
          error: `La descripción "${descripcion}" coincide con ${ids.length} productos; indica el CÓDIGO para distinguirlos.`,
        };
      }
    }
    const ref = codigo || barras || descripcion || '(fila vacía)';
    return { error: `Producto no encontrado en el catálogo: "${ref}".` };
  }

  private async cargarSedes(empresaId: number) {
    return this.prisma.sede.findMany({
      where: { empresaId, activo: true },
      select: { id: true, nombre: true, esPrincipal: true },
      orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }],
    });
  }

  /** Acepta el nombre (normalizado, o parcial si es único) o el id numérico. */
  private resolverSede(
    sedes: { id: number; nombre: string }[],
    valor: any,
  ): { id: number; nombre: string } | { error: string } {
    const s = this.normalizarTexto(valor);
    if (!s) return { error: 'sin sede' };
    if (/^\d+$/.test(s)) {
      const porId = sedes.find((x) => x.id === Number(s));
      if (porId) return porId;
    }
    const exacta = sedes.find((x) => this.normalizarTexto(x.nombre) === s);
    if (exacta) return exacta;
    const parciales = sedes.filter(
      (x) =>
        this.normalizarTexto(x.nombre).includes(s) ||
        s.includes(this.normalizarTexto(x.nombre)),
    );
    if (parciales.length === 1) return parciales[0];
    return {
      error: `Sede "${valor}" no encontrada. Sedes válidas: ${sedes.map((x) => x.nombre).join(', ')}.`,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Parseo + validación (compartido por vista previa e importación)
  // ───────────────────────────────────────────────────────────────────────────

  private async parsear(
    empresaId: number,
    sedeSesionId: number | undefined,
    buffer: Buffer,
    opts: OpcionesImport,
  ): Promise<PreviewImport> {
    const { filas, offsetFila } = this.leerFilas(buffer);
    const erroresGlobales: string[] = [];
    if (!filas.length) {
      erroresGlobales.push('El archivo no tiene filas de datos.');
    }

    const [idx, sedes] = await Promise.all([
      this.construirIndiceProductos(empresaId),
      this.cargarSedes(empresaId),
    ]);
    if (!sedes.length) {
      throw new BadRequestException('La empresa no tiene sedes activas.');
    }
    // Con una sola sede la columna SEDE es opcional; con varias es obligatoria
    // salvo que la sesión ya esté en una sede concreta (se usa esa).
    const sedeDefault =
      sedes.length === 1
        ? sedes[0]
        : (sedes.find((s) => s.id === sedeSesionId) ?? null);

    // Proveedores existentes por RUC/DNI para saber si se crean o no.
    const rucsExcel = new Set<string>();
    // Nombre del proveedor tomado de CUALQUIER fila del archivo con ese RUC
    // (basta escribirlo una vez).
    const nombreExcelPorRuc = new Map<string, string>();
    for (const f of filas) {
      const ruc = String(
        this.pick(f, ['proveedorruc', 'rucproveedor', 'proveedor', 'ruc']) ??
          '',
      ).replace(/\D/g, '');
      if (!ruc) continue;
      rucsExcel.add(ruc);
      const nom = String(
        this.pick(f, [
          'proveedornombre',
          'nombreproveedor',
          'razonsocial',
          'razonsocialproveedor',
        ]) ?? '',
      ).trim();
      if (nom && !nombreExcelPorRuc.has(ruc)) nombreExcelPorRuc.set(ruc, nom);
    }
    const proveedores = rucsExcel.size
      ? await this.prisma.cliente.findMany({
          where: {
            empresaId,
            nroDoc: { in: [...rucsExcel] },
            estado: 'ACTIVO' as any,
          },
          select: { nroDoc: true, nombre: true },
        })
      : [];
    const provPorDoc = new Map(proveedores.map((p) => [p.nroDoc, p.nombre]));

    // Compras ya registradas (evitar duplicar serie-número).
    const comprasExistentes = await this.prisma.compra.findMany({
      where: { empresaId },
      select: { serie: true, numero: true },
    });
    const clavesExistentes = new Set(
      comprasExistentes.map((c) => `${c.serie}|${c.numero}`.toUpperCase()),
    );
    let siguienteImp =
      comprasExistentes
        .filter((c) => c.serie === SERIE_IMPORT)
        .reduce((m, c) => Math.max(m, Number(c.numero) || 0), 0) + 1;

    const grupos = new Map<string, CompraImport>();
    let filasConCantidad = 0;
    const productosNuevos = new Set<string>();

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    // Columnas de cantidad POR SEDE de la plantilla ("CANT. SEDE SURCO",
    // "CANT. ALMACEN CENTRAL"…): el usuario reparte la compra escribiendo la
    // cantidad debajo de cada sede, en la misma fila del producto. Cada columna
    // con valor genera una línea de compra hacia esa sede.
    const colCantPorSede = sedes.map((sd) => ({
      sede: sd,
      claves: [
        `cant${this.normalizarClave(sd.nombre)}`,
        `cantidad${this.normalizarClave(sd.nombre)}`,
      ],
    }));

    // Cada "parte" = (sede, cantidad) de una fila. Con columnas por sede puede
    // haber varias; con CANTIDAD + SEDE (o empresa de 1 sede) hay una sola.
    const partesDeFila = (
      f: Record<string, any>,
    ): {
      cantidadRaw: any;
      sedeRaw: any;
      sedeFija: { id: number; nombre: string } | null;
    }[] => {
      // Un 0 (o vacío) en la columna de una sede = no se compró para esa
      // sede: se omite en vez de tumbar la compra con "cantidad debe ser > 0".
      const esCero = (raw: any) =>
        String(raw ?? '').trim() === '' || Number(String(raw).trim()) === 0;
      const porSede = colCantPorSede
        .map(({ sede, claves }) => ({ sede, raw: this.pick(f, claves) }))
        .filter((x) => x.raw != null && !esCero(x.raw));
      if (porSede.length) {
        return porSede.map((x) => ({
          cantidadRaw: x.raw,
          sedeRaw: x.sede.nombre,
          sedeFija: x.sede,
        }));
      }
      const cantidadRaw = this.pick(f, ['cantidad', 'cant', 'qty', 'unidades']);
      if (cantidadRaw == null) return [];
      return [
        {
          cantidadRaw,
          sedeRaw: this.pick(f, [
            'sede',
            'almacen',
            'sededestino',
            'sucursal',
            'tienda',
          ]),
          sedeFija: null,
        },
      ];
    };

    filas.forEach((f, i) => {
      const nFila = i + 2 + offsetFila; // fila real de Excel (1 = encabezado si no hay título)
      const partes = partesDeFila(f);
      // Fila de la plantilla sin cantidad → no se compró → se ignora.
      if (!partes.length) return;
      filasConCantidad += 1;
      for (const parte of partes) {
        procesarParte(f, nFila, parte);
      }
    });

    function procesarParte(
      this: void,
      f: Record<string, any>,
      nFila: number,
      parte: {
        cantidadRaw: any;
        sedeRaw: any;
        sedeFija: { id: number; nombre: string } | null;
      },
    ) {
      const { cantidadRaw } = parte;
      // La parte existe porque la celda tiene algo: null (vacía) ya se filtró en
      // partesDeFila; aquí null solo sería un dato inválido.
      const cantidad = self.numero(cantidadRaw) ?? NaN;

      const codigo = String(
        self.pick(f, ['codigo', 'sku', 'codigoproducto', 'productocodigo']) ??
          '',
      ).trim();
      const barras = String(
        self.pick(f, ['codigodebarras', 'codigobarras', 'ean', 'barras']) ?? '',
      ).trim();
      const descripcion = String(
        self.pick(f, [
          'descripcion',
          'producto',
          'nombre',
          'productodescripcion',
        ]) ?? '',
      ).trim();
      const costoUnitario = self.numero(
        self.pick(f, [
          'costounitario',
          'costo',
          'preciounitario',
          'precio',
          'preciocompra',
          'costocompra',
        ]),
      );
      const incluyeIgv = self.booleano(
        self.pick(f, ['incluyeigv', 'conigv', 'igvincluido']),
        opts.incluyeIgvDefault,
      );
      const lote = String(self.pick(f, ['lote']) ?? '').trim() || undefined;
      const fechaVencimientoRaw = self.pick(f, [
        'fvencimiento',
        'fechavencimiento',
        'vencimiento',
        'fvcto',
      ]);
      const fechaVencimiento = fechaVencimientoRaw
        ? self.fechaISO(fechaVencimientoRaw)
        : null;

      const mensajes: string[] = [];
      let estado: EstadoLinea = 'OK';
      const error = (m: string) => {
        mensajes.push(m);
        estado = 'ERROR';
      };
      const aviso = (m: string) => {
        mensajes.push(m);
        if (estado === 'OK') estado = 'AVISO';
      };

      if (Number.isNaN(cantidad)) {
        error(`Cantidad inválida: "${String(cantidadRaw)}".`);
      } else if (cantidad <= 0) error('La cantidad debe ser mayor a 0.');
      if (costoUnitario == null) error('Falta el COSTO UNITARIO.');
      else if (Number.isNaN(costoUnitario))
        error('Costo unitario inválido (debe ser un número).');
      else if (costoUnitario < 0)
        error('El costo unitario no puede ser negativo.');
      else if (costoUnitario === 0)
        aviso(
          'Costo 0: el producto entrará sin costo (ganancia inflada en reportes).',
        );
      if (fechaVencimientoRaw && !fechaVencimiento) {
        error(
          `Fecha de vencimiento inválida: "${fechaVencimientoRaw}" (usa AAAA-MM-DD o DD/MM/AAAA).`,
        );
      }

      // Producto
      let productoId: number | null = null;
      let productoNombre: string | null = null;
      let productoNuevo = false;
      let cantidadReal = cantidad;
      let costoReal = costoUnitario ?? 0;
      const res = self.resolverProducto(idx, codigo, barras, descripcion);
      if ('id' in res) {
        productoId = res.id;
        productoNombre = idx.nombres.get(res.id) ?? null;
        if (res.unidades > 1) {
          cantidadReal = cantidad * res.unidades;
          costoReal = self.r2((costoUnitario ?? 0) / res.unidades);
          aviso(
            `Código de paquete (x${res.unidades}): entran ${cantidadReal} unidades a ${costoReal.toFixed(2)} c/u (moneda del documento).`,
          );
        }
        if (res.via === 'descripción') {
          aviso(
            'Producto ubicado por descripción; se recomienda usar el CÓDIGO.',
          );
        }
      } else if (opts.crearProductos && descripcion) {
        productoNuevo = true;
        productoNombre = descripcion;
        productosNuevos.add(self.normalizarTexto(codigo || descripcion));
        aviso(
          `Producto nuevo: se creará "${descripcion}" en el catálogo${codigo ? ` con código ${codigo}` : ''}.`,
        );
      } else {
        error(
          res.error +
            (opts.crearProductos && !descripcion
              ? ' Agrega la DESCRIPCIÓN para poder crearlo.'
              : ' Revisa el CÓDIGO / CÓDIGO DE BARRAS.'),
        );
      }

      // Sede destino: columna por sede (fija) o columna SEDE / sede por defecto.
      const sedeRaw = parte.sedeRaw;
      let sede: { id: number; nombre: string } | null = parte.sedeFija;
      if (sede) {
        // ya resuelta por la columna "CANT. <SEDE>"
      } else if (sedeRaw != null) {
        const r = self.resolverSede(sedes, sedeRaw);
        if ('error' in r) error(r.error);
        else sede = r;
      } else if (sedeDefault) {
        sede = sedeDefault;
      } else {
        error(
          `Falta la SEDE (la empresa tiene ${sedes.length} sedes: ${sedes.map((s) => s.nombre).join(', ')}).`,
        );
      }

      // Comprobante / proveedor (opcionales)
      const proveedorRuc = String(
        self.pick(f, ['proveedorruc', 'rucproveedor', 'proveedor', 'ruc']) ??
          '',
      ).replace(/\D/g, '');
      const proveedorNombreExcel = String(
        self.pick(f, [
          'proveedornombre',
          'nombreproveedor',
          'razonsocial',
          'razonsocialproveedor',
        ]) ?? '',
      ).trim();
      let tipoDoc = self
        .normalizarTexto(
          self.pick(f, [
            'tipodoc',
            'tipodocumento',
            'tipocomprobante',
            'documento',
          ]) ?? '',
        )
        .toUpperCase();
      const serie = String(self.pick(f, ['serie']) ?? '')
        .trim()
        .toUpperCase();
      const numeroDoc = String(
        self.pick(f, ['numero', 'nro', 'correlativo', 'numerodocumento']) ?? '',
      ).trim();
      const fechaRaw = self.pick(f, ['fecha', 'fechaemision', 'fechacompra']);
      const fechaEmision = fechaRaw ? self.fechaISO(fechaRaw) : null;
      if (fechaRaw && !fechaEmision)
        error(`Fecha inválida: "${fechaRaw}" (usa AAAA-MM-DD o DD/MM/AAAA).`);
      const moneda =
        self
          .normalizarTexto(self.pick(f, ['moneda']) ?? 'pen')
          .toUpperCase() === 'USD'
          ? 'USD'
          : 'PEN';
      const tipoCambio = self.numero(self.pick(f, ['tipocambio', 'tc']));
      const observaciones = String(
        self.pick(f, ['observaciones', 'observacion', 'nota', 'glosa']) ?? '',
      ).trim();

      if (
        proveedorRuc &&
        proveedorRuc.length !== 11 &&
        proveedorRuc.length !== 8
      ) {
        error(
          `Documento de proveedor inválido: "${proveedorRuc}" (RUC 11 dígitos o DNI 8 dígitos).`,
        );
      }
      if (tipoDoc && !TIPOS_DOC_COMPRA.has(tipoDoc)) {
        aviso(
          `Tipo de documento "${tipoDoc}" no reconocido; se registra como OTRO.`,
        );
        tipoDoc = 'OTRO';
      }
      if (tipoDoc === 'NV' || tipoDoc === 'NOTA_VENTA')
        tipoDoc = 'NOTA DE VENTA';
      if (tipoDoc === 'SIN_COMPROBANTE') tipoDoc = 'SIN COMPROBANTE';
      const tieneDoc = !!(serie && numeroDoc);
      if (tieneDoc && !proveedorRuc) {
        aviso(
          `${tipoDoc || 'FACTURA'} ${serie}-${numeroDoc} sin PROVEEDOR RUC: se registrará al proveedor genérico "${PROVEEDOR_GENERICO_NOMBRE}".`,
        );
      }
      if ((serie && !numeroDoc) || (!serie && numeroDoc)) {
        error(
          'Para registrar el comprobante indica SERIE y NÚMERO (o deja ambos vacíos).',
        );
      }
      if (tipoCambio != null && Number.isNaN(tipoCambio)) {
        error('TIPO CAMBIO inválido (debe ser un número).');
      }
      if (moneda === 'USD' && !(tipoCambio && tipoCambio > 0)) {
        error('Compra en USD: indica el TIPO CAMBIO.');
      }

      // Clave de agrupación:
      //  · Con comprobante → UNA compra por proveedor + documento; cada línea
      //    lleva su propia sede (distribución por sede: la factura es una,
      //    la mercadería se reparte).
      //  · Sin comprobante → una compra por sede y moneda (no mezclar PEN/USD).
      const provClave = proveedorRuc || PROVEEDOR_GENERICO_RUC;
      const sedeClave = sede
        ? String(sede.id)
        : `?${self.normalizarTexto(sedeRaw)}`;
      const docClave = tieneDoc
        ? `${serie}|${numeroDoc}`
        : `SIN_DOC|${moneda}|${sedeClave}`;
      const clave = `${provClave}|${docClave}`;

      let grupo = grupos.get(clave);
      if (!grupo) {
        const proveedorExiste = proveedorRuc
          ? provPorDoc.has(proveedorRuc)
          : true;
        grupo = {
          clave,
          sedeId: sede?.id ?? null,
          sedeNombre: sede?.nombre ?? String(sedeRaw ?? '—'),
          sedesNombres: sede ? [sede.nombre] : [],
          proveedorRuc: provClave,
          proveedorNombre: proveedorRuc
            ? provPorDoc.get(proveedorRuc) ||
              nombreExcelPorRuc.get(proveedorRuc) ||
              proveedorNombreExcel ||
              ''
            : PROVEEDOR_GENERICO_NOMBRE,
          proveedorExiste,
          tipoDoc: tipoDoc || (tieneDoc ? 'FACTURA' : 'SIN COMPROBANTE'),
          serie: tieneDoc ? serie : SERIE_IMPORT,
          numero: tieneDoc ? numeroDoc : '',
          sinComprobante: !tieneDoc,
          fechaEmision: fechaEmision ?? self.hoyISO(),
          moneda,
          tipoCambio: moneda === 'USD' ? (tipoCambio ?? undefined) : undefined,
          observaciones: observaciones || undefined,
          lineas: [],
          subtotal: 0,
          igv: 0,
          total: 0,
          estado: 'OK',
          errores: [],
        };
        grupos.set(clave, grupo);
      } else {
        // Datos de cabecera contradictorios dentro del mismo documento
        if (grupo.moneda !== moneda) {
          error(
            `La moneda (${moneda}) difiere de otras filas del mismo documento (${grupo.moneda}).`,
          );
        }
        if (fechaEmision && grupo.fechaEmision !== fechaEmision && fechaRaw) {
          aviso(
            `La fecha difiere de otras filas del mismo documento (se usa ${grupo.fechaEmision}).`,
          );
        }
        if (!grupo.proveedorNombre && proveedorNombreExcel)
          grupo.proveedorNombre = proveedorNombreExcel;
        if (!grupo.observaciones && observaciones)
          grupo.observaciones = observaciones;
      }

      // Totales de la línea (misma fórmula que ComprasService.crear)
      // Celdas inválidas (NaN) ya marcaron error; para los totales cuentan 0.
      // Producto exonerado/inafecto: sin IGV (el costo tecleado es el neto).
      const qtyCalc = Number.isFinite(cantidadReal) ? cantidadReal : 0;
      const costoCalc = Number.isFinite(costoReal) ? costoReal : 0;
      const gravado = productoId ? (idx.gravado.get(productoId) ?? true) : true;
      const costoNeto = gravado && incluyeIgv ? costoCalc / 1.18 : costoCalc;
      const subtotalLinea = self.r2(costoNeto * qtyCalc);
      const totalLinea = !gravado
        ? subtotalLinea
        : self.r2(
            incluyeIgv ? costoCalc * qtyCalc : costoNeto * 1.18 * qtyCalc,
          );
      if (!gravado && incluyeIgv) {
        aviso('Producto exonerado/inafecto: no lleva IGV, el costo se toma tal cual.');
      }

      if (sede && !grupo.sedesNombres.includes(sede.nombre)) {
        grupo.sedesNombres.push(sede.nombre);
      }
      // Cabecera sin sede válida (1ª fila con sede mala) pero esta sí: tomarla.
      if (!grupo.sedeId && sede) {
        grupo.sedeId = sede.id;
        grupo.sedeNombre = sede.nombre;
      }

      grupo.lineas.push({
        fila: nFila,
        sedeId: sede?.id ?? null,
        sedeNombre: sede?.nombre ?? String(sedeRaw ?? '—'),
        codigo,
        descripcion: descripcion || productoNombre || '',
        productoId,
        productoNombre,
        productoNuevo,
        cantidad: qtyCalc,
        costoUnitario: costoCalc,
        incluyeIgv,
        lote,
        fechaVencimiento: fechaVencimiento ?? undefined,
        subtotal: subtotalLinea,
        total: totalLinea,
        estado,
        mensajes,
      });
    }

    // Cerrar grupos: numerar los "sin comprobante", validar duplicados, totales.
    const compras = [...grupos.values()];
    const vistosEnArchivo = new Map<string, CompraImport>();
    for (const g of compras) {
      const claveDoc = `${g.serie}|${g.numero}`.toUpperCase();
      if (!g.sinComprobante && clavesExistentes.has(claveDoc)) {
        g.errores.push(
          `Ya existe una compra registrada con ${g.serie}-${g.numero}.`,
        );
      }
      // El sistema no admite dos compras con la misma serie-número (aunque
      // sean de proveedores o sedes distintos): la segunda del archivo se marca.
      if (!g.sinComprobante) {
        const previo = vistosEnArchivo.get(claveDoc);
        if (previo) {
          g.errores.push(
            `${g.serie}-${g.numero} se repite en el archivo (ya usado por ${previo.proveedorNombre || previo.proveedorRuc} / ${previo.sedeNombre}). Un mismo comprobante no puede registrarse dos veces; si es otra sede, usa filas del mismo documento con distinta SEDE… o corrige el número.`,
          );
        } else {
          vistosEnArchivo.set(claveDoc, g);
        }
      }
      if (
        g.proveedorRuc !== PROVEEDOR_GENERICO_RUC &&
        !g.proveedorExiste &&
        !g.proveedorNombre
      ) {
        // Al importar se intenta el nombre por SUNAT/RENIEC; si falla, esa
        // compra se reporta como fallida con el motivo.
        g.lineas.forEach((l) => {
          if (l.estado === 'OK') l.estado = 'AVISO';
          l.mensajes.push(
            `Proveedor ${g.proveedorRuc} nuevo: se creará (nombre por SUNAT/RENIEC o columna PROVEEDOR NOMBRE).`,
          );
        });
      }
      if (!g.sedeId) g.errores.push('Sede destino no válida.');
      else if (g.lineas.some((l) => !l.sedeId)) {
        g.errores.push('Hay líneas sin sede destino válida.');
      }
      g.subtotal = this.r2(g.lineas.reduce((a, l) => a + l.subtotal, 0));
      g.total = this.r2(g.lineas.reduce((a, l) => a + l.total, 0));
      g.igv = this.r2(g.total - g.subtotal);
      const hayError =
        g.errores.length > 0 || g.lineas.some((l) => l.estado === 'ERROR');
      const hayAviso = g.lineas.some((l) => l.estado === 'AVISO');
      g.estado = hayError ? 'ERROR' : hayAviso ? 'AVISO' : 'OK';
    }
    // Número IMP correlativo solo para las compras sin comprobante que SÍ se
    // van a importar (las con error no consumen número → sin huecos).
    for (const g of compras) {
      if (!g.sinComprobante) continue;
      g.numero =
        g.estado === 'ERROR' ? '—' : String(siguienteImp++).padStart(6, '0');
    }
    compras.sort(
      (a, b) =>
        a.sedeNombre.localeCompare(b.sedeNombre) ||
        a.serie.localeCompare(b.serie) ||
        a.numero.localeCompare(b.numero),
    );

    if (filas.length && filasConCantidad === 0) {
      erroresGlobales.push(
        'Ninguna fila tiene CANTIDAD: llena la cantidad de los productos comprados (las filas sin cantidad se ignoran).',
      );
    }
    const lineas = compras.flatMap((c) => c.lineas);
    return {
      resumen: {
        filasLeidas: filas.length,
        filasConCantidad,
        lineasOk: lineas.filter((l) => l.estado === 'OK').length,
        lineasAviso: lineas.filter((l) => l.estado === 'AVISO').length,
        lineasError: lineas.filter((l) => l.estado === 'ERROR').length,
        compras: compras.length,
        comprasOk: compras.filter((c) => c.estado !== 'ERROR').length,
        comprasError: compras.filter((c) => c.estado === 'ERROR').length,
        productosNuevos: productosNuevos.size,
        totalGeneral: this.r2(
          compras
            .filter((c) => c.estado !== 'ERROR')
            .reduce((a, c) => a + c.total, 0),
        ),
      },
      sedes: sedes.map((s) => ({ id: s.id, nombre: s.nombre })),
      compras,
      erroresGlobales,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // API pública
  // ───────────────────────────────────────────────────────────────────────────

  async previsualizar(
    empresaId: number,
    sedeSesionId: number | undefined,
    buffer: Buffer,
    opts: OpcionesImport,
  ): Promise<PreviewImport> {
    return this.parsear(empresaId, sedeSesionId, buffer, opts);
  }

  /**
   * Importa las compras válidas del archivo. Cada compra se crea por separado
   * con `ComprasService.crear` (kardex, costo promedio, lotes, cuentas por
   * pagar, aprobación). Las compras con error no se tocan; si una falla al
   * grabar, las demás siguen y se informa el motivo.
   */
  async importar(
    empresaId: number,
    usuarioId: number,
    usuarioRol: string | undefined,
    sedeSesionId: number | undefined,
    buffer: Buffer,
    opts: OpcionesImport,
  ): Promise<ResultadoImport> {
    const preview = await this.parsear(empresaId, sedeSesionId, buffer, opts);
    const importadas: ResultadoImport['importadas'] = [];
    const fallidas: ResultadoImport['fallidas'] = [];

    // Proveedores: resolver/crear una vez por RUC.
    const proveedorIdPorRuc = new Map<string, number>();
    // Productos nuevos: crear una vez por código/descripción (varias sedes
    // pueden comprar el mismo producto nuevo en el mismo archivo).
    const productoNuevoId = new Map<string, number>();

    for (const g of preview.compras) {
      if (g.estado === 'ERROR') continue;
      try {
        // Proveedor
        let proveedorId = proveedorIdPorRuc.get(g.proveedorRuc);
        if (!proveedorId) {
          proveedorId = await this.resolverProveedor(
            empresaId,
            g.proveedorRuc,
            g.proveedorNombre,
          );
          proveedorIdPorRuc.set(g.proveedorRuc, proveedorId);
        }

        // Productos nuevos
        for (const l of g.lineas) {
          if (!l.productoNuevo) continue;
          const k = this.normalizarTexto(l.codigo || l.descripcion);
          let id = productoNuevoId.get(k);
          if (!id) {
            id = await this.crearProductoMinimo(
              empresaId,
              l.sedeId ?? g.sedeId!,
              l,
              // Costo y precio provisional del producto nuevo en SOLES.
              g.moneda === 'USD' ? Number(g.tipoCambio) || 1 : 1,
            );
            productoNuevoId.set(k, id);
          }
          l.productoId = id;
        }

        const dto: CrearCompraDto = {
          proveedorId,
          tipoDoc: g.tipoDoc,
          serie: g.serie,
          numero: g.numero,
          fechaEmision: g.fechaEmision,
          moneda: g.moneda,
          tipoCambio: g.tipoCambio,
          observaciones: [
            g.observaciones,
            `Importada desde Excel (${g.lineas.length} líneas${
              g.sedesNombres.length > 1
                ? `, distribuida en ${g.sedesNombres.join(' / ')}`
                : ''
            }).`,
          ]
            .filter(Boolean)
            .join(' · '),
          sedeId: g.sedeId!,
          detalles: g.lineas.map((l) => ({
            productoId: l.productoId!,
            descripcion: l.productoNombre || l.descripcion,
            cantidad: l.cantidad,
            precioUnitario: l.costoUnitario,
            incluyeIgv: l.incluyeIgv,
            lote: l.lote,
            fechaVencimiento: l.fechaVencimiento,
            // Distribución por sede: cada línea entra a su sede.
            sedeId: l.sedeId ?? undefined,
          })),
          ...(opts.marcarPagado
            ? {
                montoPagadoInicial: g.total,
                metodoPagoInicial: opts.metodoPago || 'EFECTIVO',
              }
            : {}),
        } as CrearCompraDto;

        const creada: any = g.sinComprobante
          ? await this.crearConNumeroImp(
              empresaId,
              usuarioId,
              dto,
              sedeSesionId,
              usuarioRol,
              g,
            )
          : await this.comprasService.crear(
              empresaId,
              usuarioId,
              dto,
              sedeSesionId,
              usuarioRol,
            );
        importadas.push({
          compraId: creada.id,
          serie: creada.serie ?? g.serie,
          numero: creada.numero ?? g.numero,
          sedeNombre: g.sedeNombre,
          total: g.total,
          avisosStock: creada.stockWarnings?.length
            ? creada.stockWarnings
            : undefined,
          pendienteAprobacion: creada.estado === 'PENDIENTE_APROBACION',
        });
      } catch (e: any) {
        fallidas.push({
          clave: g.clave,
          serie: g.serie,
          numero: g.numero,
          motivo: e?.message || 'Error desconocido',
        });
      }
    }

    return { ...preview, importadas, fallidas };
  }

  /**
   * Compra "sin comprobante" (serie IMP): el número de la vista previa es
   * provisional. Al grabar se toma el siguiente correlativo real de la BD y,
   * si otro usuario lo ganó en ese instante (unique serie+número), se
   * reintenta con el siguiente.
   */
  private async crearConNumeroImp(
    empresaId: number,
    usuarioId: number,
    dto: CrearCompraDto,
    sedeSesionId: number | undefined,
    usuarioRol: string | undefined,
    g: CompraImport,
  ): Promise<any> {
    const ultimo = await this.prisma.compra.aggregate({
      where: { empresaId, serie: SERIE_IMPORT },
      _count: { _all: true },
    });
    // Max numérico de la serie IMP (los números se guardan como texto).
    const imps = ultimo._count._all
      ? await this.prisma.compra.findMany({
          where: { empresaId, serie: SERIE_IMPORT },
          select: { numero: true },
        })
      : [];
    let n = imps.reduce((m, c) => Math.max(m, Number(c.numero) || 0), 0) + 1;
    let ultimoError: any = null;
    for (let intento = 0; intento < 5; intento++) {
      const numero = String(n).padStart(6, '0');
      try {
        const creada = await this.comprasService.crear(
          empresaId,
          usuarioId,
          { ...dto, numero },
          sedeSesionId,
          usuarioRol,
        );
        g.numero = numero;
        return creada;
      } catch (e: any) {
        ultimoError = e;
        const msg = String(e?.message || '');
        // Solo reintentar por colisión de número; cualquier otro error sube.
        if (!/Ya existe una compra registrada con la serie/i.test(msg)) throw e;
        n += 1;
      }
    }
    throw ultimoError;
  }

  /** Busca el proveedor por documento; si no existe lo crea (nombre por SUNAT/RENIEC si falta). */
  private async resolverProveedor(
    empresaId: number,
    doc: string,
    nombreExcel: string,
  ): Promise<number> {
    const existente = await this.prisma.cliente.findFirst({
      where: { empresaId, nroDoc: doc, estado: 'ACTIVO' as any },
      select: { id: true },
    });
    if (existente) return existente.id;

    const esGenerico = doc === PROVEEDOR_GENERICO_RUC;
    const tipoDoc = doc.length === 8 ? 'DNI' : 'RUC';
    let nombre = esGenerico ? PROVEEDOR_GENERICO_NOMBRE : nombreExcel;
    let direccion: string | undefined;
    if (!nombre) {
      try {
        const data: any = await this.clienteService.consultarDocumento(
          doc,
          tipoDoc,
        );
        nombre =
          tipoDoc === 'RUC'
            ? String(
                data?.nombre_o_razon_social ??
                  data?.razonSocial ??
                  data?.nombre ??
                  '',
              ).trim()
            : String(
                data?.nombre_completo ??
                  `${data?.nombres ?? ''} ${data?.apellido_paterno ?? ''} ${data?.apellido_materno ?? ''}`,
              ).trim();
        if (tipoDoc === 'RUC' && data?.direccion)
          direccion = String(data.direccion);
      } catch {
        // sin consulta externa: se exige el nombre en el Excel
      }
    }
    if (!nombre) {
      throw new BadRequestException(
        `No se pudo obtener el nombre del proveedor ${doc}. Agrega la columna PROVEEDOR NOMBRE.`,
      );
    }
    const creado = await this.clienteService.crear({
      nombre,
      tipoDoc: esGenerico ? 'RUC' : (tipoDoc as 'DNI' | 'RUC'),
      nroDoc: doc,
      empresaId,
      direccion,
      persona: 'PROVEEDOR',
    } as any);
    return creado.id;
  }

  /** Alta mínima de un producto que no existía: stock 0 (la compra lo sube). */
  private async crearProductoMinimo(
    empresaId: number,
    sedeId: number,
    l: LineaImport,
    factorSoles = 1,
  ): Promise<number> {
    const costoNeto =
      (l.incluyeIgv ? l.costoUnitario / 1.18 : l.costoUnitario) * factorSoles;
    // Precio de venta provisional (costo con IGV + 30%) para que se pueda vender;
    // el usuario lo ajusta desde Inventario.
    const precioVenta = this.r2(costoNeto * 1.18 * 1.3);
    const creado: any = await this.productoService.crear(
      {
        codigo: l.codigo || undefined,
        descripcion: l.descripcion,
        tipoAfectacionIGV: '10',
        precioUnitario: precioVenta,
        stock: 0,
        costoUnitario: this.r2(costoNeto),
      } as any,
      empresaId,
      sedeId,
    );
    return creado.id;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Plantilla precargada con el catálogo y el stock por sede
  // ───────────────────────────────────────────────────────────────────────────

  async plantilla(empresaId: number): Promise<Buffer> {
    const [sedes, productos] = await Promise.all([
      this.cargarSedes(empresaId),
      this.prisma.producto.findMany({
        where: { empresaId, estado: 'ACTIVO' as any },
        select: {
          id: true,
          codigo: true,
          codigoBarras: true,
          descripcion: true,
          costoPromedio: true,
          unidadMedida: { select: { codigo: true } },
          stocks: { select: { sedeId: true, stock: true } },
        },
        orderBy: { codigo: 'asc' },
      }),
    ]);

    const multiSede = sedes.length > 1;
    const colsStock = sedes.map((s) => `STOCK ${s.nombre.toUpperCase()}`);
    // Multi-sede: una columna de cantidad POR SEDE ("CANT. SEDE SURCO"…) para
    // repartir la compra en la misma fila. Una sede: CANTIDAD a secas.
    const colsCantidad = multiSede
      ? sedes.map((s) => `CANT. ${s.nombre.toUpperCase()}`)
      : ['CANTIDAD'];
    const encabezados = [
      'CÓDIGO',
      'CÓDIGO DE BARRAS',
      'DESCRIPCIÓN',
      'UNIDAD',
      ...colsStock,
      'COSTO ACTUAL',
      ...colsCantidad,
      'COSTO UNITARIO',
      'INCLUYE IGV',
      'LOTE',
      'F. VENCIMIENTO',
      'PROVEEDOR RUC',
      'PROVEEDOR NOMBRE',
      'TIPO DOC',
      'SERIE',
      'NÚMERO',
      'FECHA',
      'MONEDA',
      'TIPO CAMBIO',
      'OBSERVACIONES',
    ];

    const filas: any[][] = [encabezados];
    for (const p of productos) {
      const stockPorSede = sedes.map((s) => {
        const st = p.stocks.find((x) => x.sedeId === s.id);
        return st ? Number(st.stock) : 0;
      });
      filas.push([
        p.codigo,
        p.codigoBarras || '',
        p.descripcion,
        p.unidadMedida?.codigo || 'NIU',
        ...stockPorSede,
        Number(p.costoPromedio || 0),
        ...colsCantidad.map(() => ''),
        ...encabezados
          .slice(5 + sedes.length + colsCantidad.length)
          .map(() => ''),
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws['!cols'] = encabezados.map((h) => ({
      wch:
        h === 'DESCRIPCIÓN'
          ? 45
          : h === 'PROVEEDOR NOMBRE' || h === 'OBSERVACIONES'
            ? 28
            : h.startsWith('CANT.')
              ? Math.max(14, h.length + 2)
              : Math.max(12, h.length + 2),
    }));
    ws['!freeze'] = { xSplit: 3, ySplit: 1 } as any;
    (ws as any)['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: filas.length - 1, c: encabezados.length - 1 },
      }),
    };

    const instrucciones: any[][] = [
      ['CÓMO IMPORTAR TU COMPRA DESDE EXCEL'],
      [''],
      [
        '1. La hoja COMPRAS ya trae tu catálogo (código, código de barras, descripción y stock por sede).',
      ],
      multiSede
        ? [
            '2. Escribe la CANTIDAD comprada debajo de la columna de CADA SEDE (CANT. ' +
              sedes.map((s) => s.nombre.toUpperCase()).join(' / CANT. ') +
              ') y el COSTO UNITARIO. Si un producto va a varias sedes, llena varias columnas en la MISMA fila. Las filas sin cantidad se ignoran.',
          ]
        : [
            '2. Llena CANTIDAD y COSTO UNITARIO solo en los productos que compraste. Las filas sin cantidad se ignoran.',
          ],
      multiSede
        ? [
            '3. Las filas de un mismo comprobante forman UNA compra; cada cantidad entra al stock de su sede (compra distribuida). También puedes usar columnas CANTIDAD + SEDE si prefieres una fila por sede.',
          ]
        : ['3. El stock entra a tu única sede: ' + sedes[0].nombre],
      [
        '4. INCLUYE IGV: SI si el costo ya trae IGV, NO si es sin IGV. Si lo dejas vacío se usa lo que elijas al subir el archivo.',
      ],
      [
        '5. Datos del comprobante (PROVEEDOR RUC, TIPO DOC, SERIE, NÚMERO, FECHA) son opcionales:',
      ],
      [
        '   - Si los llenas, las filas con el mismo proveedor + serie + número + sede se agrupan en UNA compra.',
      ],
      [
        '   - Si los dejas vacíos, se crea una compra "SIN COMPROBANTE" por sede (serie IMP, número automático).',
      ],
      [
        '6. Producto nuevo (no está en tu catálogo): escribe su CÓDIGO (opcional) y DESCRIPCIÓN y activa "Crear productos nuevos" al subir.',
      ],
      [
        '7. Puedes borrar las filas que no uses o agregar filas nuevas al final; solo importa que las columnas se mantengan.',
      ],
      [
        '8. TIPO DOC: FACTURA, BOLETA, NOTA DE VENTA, RECIBO, SIN COMPROBANTE u OTRO. FECHA: AAAA-MM-DD o DD/MM/AAAA. MONEDA: PEN o USD (con TIPO CAMBIO).',
      ],
      [''],
      [
        'Al subir el archivo verás una VISTA PREVIA con cada compra y sus líneas (OK / aviso / error) antes de confirmar. Nada se graba hasta que confirmes.',
      ],
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instrucciones);
    wsInstr['!cols'] = [{ wch: 120 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'COMPRAS');
    XLSX.utils.book_append_sheet(wb, wsInstr, 'INSTRUCCIONES');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  }
}
