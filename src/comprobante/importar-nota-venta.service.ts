import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { ComprobanteService } from './comprobante.service';
import { ClienteService } from '../cliente/cliente.service';
import { ImportarNotaVentaDto } from './dto/importar-nota-venta.dto';

export interface ResultadoImportNV {
  total: number;
  importados: number;
  conError: number;
  detalleImportados: {
    documento: string;
    comprobanteId: number;
  }[];
  detalleErrores: {
    fila?: number;
    documento?: string;
    motivo: string;
  }[];
}

/**
 * Importación de "Notas de venta" (comprobante informal `tipoDoc = 'NV'`) desde
 * Excel/CSV para cargar el movimiento histórico. NO envía nada a SUNAT: registra
 * cada NV con su serie/correlativo ORIGINAL. Por defecto NO afecta stock ni caja.
 *
 * Formato de la hoja (una fila por línea de producto; se agrupan las filas que
 * comparten Serie + Correlativo en una sola Nota de venta):
 *   Serie | Correlativo | FechaEmision | ClienteTipoDoc | ClienteNumDoc |
 *   ClienteNombre | MedioPago | EstadoPago | ProductoCodigo |
 *   ProductoDescripcion | Cantidad | PrecioUnitario
 */
@Injectable()
export class ImportarNotaVentaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comprobanteService: ComprobanteService,
    private readonly clienteService: ClienteService,
  ) {}

  private normalizarClave(k: string): string {
    return k
      .toString()
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '');
  }

  /** Lee la primera hoja del archivo como arreglo de objetos con claves normalizadas. */
  private leerFilas(buffer: Buffer): Record<string, any>[] {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException(
        'No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) o CSV válido.',
      );
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new BadRequestException('El archivo no tiene hojas.');
    const filas = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
      defval: null,
      raw: false,
    });
    return filas.map((f) => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(f)) {
        out[this.normalizarClave(k)] = typeof v === 'string' ? v.trim() : v;
      }
      return out;
    });
  }

  private pick(fila: Record<string, any>, claves: string[]): any {
    for (const c of claves) {
      if (fila[c] != null && String(fila[c]).trim() !== '') return fila[c];
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Matching de PRODUCTO por código / código de barras / descripción
  // ---------------------------------------------------------------------------
  private async construirIndiceProductos(empresaId: number) {
    const productos = await this.prisma.producto.findMany({
      where: { empresaId, estado: 'ACTIVO' as any },
      select: {
        id: true,
        codigo: true,
        codigoBarras: true,
        descripcion: true,
        precioUnitario: true,
      },
    });
    const porCodigo = new Map<string, number>();
    const porBarras = new Map<string, number>();
    const porDescripcion = new Map<string, number>();
    for (const p of productos) {
      if (p.codigo)
        porCodigo.set(String(p.codigo).trim().toLowerCase(), p.id);
      if (p.codigoBarras)
        porBarras.set(String(p.codigoBarras).trim().toLowerCase(), p.id);
      if (p.descripcion)
        porDescripcion.set(String(p.descripcion).trim().toLowerCase(), p.id);
    }
    return { porCodigo, porBarras, porDescripcion };
  }

  private resolverProductoId(
    indice: {
      porCodigo: Map<string, number>;
      porBarras: Map<string, number>;
      porDescripcion: Map<string, number>;
    },
    codigo?: string | null,
    descripcion?: string | null,
  ): number {
    const cod = codigo != null ? String(codigo).trim().toLowerCase() : '';
    const desc =
      descripcion != null ? String(descripcion).trim().toLowerCase() : '';
    if (cod) {
      const porCod = indice.porCodigo.get(cod) ?? indice.porBarras.get(cod);
      if (porCod) return porCod;
    }
    if (desc) {
      const porDesc = indice.porDescripcion.get(desc);
      if (porDesc) return porDesc;
    }
    throw new BadRequestException(
      `Producto no encontrado en el catálogo (código: ${codigo || '-'}, descripción: ${descripcion || '-'}).`,
    );
  }

  // ---------------------------------------------------------------------------
  // Resolución de CLIENTE por RUC / DNI (busca; si no existe, lo crea)
  // ---------------------------------------------------------------------------
  private async resolverCliente(
    empresaId: number,
    numDocRaw?: string | null,
    tipoDocRaw?: string | null,
    nombreRaw?: string | null,
  ): Promise<{ clienteId?: number; clienteName?: string }> {
    const numDoc = String(numDocRaw ?? '').replace(/\D/g, '');
    if (!numDoc) {
      return { clienteName: 'CLIENTES VARIOS' };
    }

    // Inferir tipo si no se indicó explícitamente.
    let tipoDoc = String(tipoDocRaw ?? '').trim().toUpperCase();
    if (tipoDoc !== 'DNI' && tipoDoc !== 'RUC') {
      if (numDoc.length === 11) tipoDoc = 'RUC';
      else if (numDoc.length === 8) tipoDoc = 'DNI';
      else
        throw new BadRequestException(
          `Documento de cliente inválido: "${numDocRaw}". Usa DNI (8 dígitos) o RUC (11 dígitos).`,
        );
    }

    // Buscar cliente existente.
    const existente = await this.prisma.cliente.findFirst({
      where: { empresaId, nroDoc: numDoc, estado: 'ACTIVO' as any },
      select: { id: true },
    });
    if (existente) return { clienteId: existente.id };

    // No existe → crear. Intentar nombre por RENIEC/SUNAT (apiperu) si no vino.
    let nombre = String(nombreRaw ?? '').trim();
    let direccion: string | undefined;
    let ubigeo = '';
    let departamento = '';
    let provincia = '';
    let distrito = '';
    if (!nombre) {
      try {
        const data: any = await this.clienteService.consultarDocumento(
          numDoc,
          tipoDoc,
        );
        if (data) {
          nombre =
            tipoDoc === 'RUC'
              ? String(
                  data.nombre_o_razon_social ??
                    data.razonSocial ??
                    data.nombre ??
                    '',
                ).trim()
              : String(
                  data.nombre_completo ??
                    `${data.nombres ?? ''} ${data.apellido_paterno ?? ''} ${data.apellido_materno ?? ''}`,
                ).trim();
          if (tipoDoc === 'RUC') {
            direccion = data.direccion ? String(data.direccion) : undefined;
            ubigeo = String(
              Array.isArray(data.ubigeo)
                ? (data.ubigeo[2] ?? data.ubigeo[0] ?? '')
                : (data.ubigeo ?? ''),
            );
            departamento = String(data.departamento ?? '');
            provincia = String(data.provincia ?? '');
            distrito = String(data.distrito ?? '');
          }
        }
      } catch {
        // Ignorar fallo de la consulta externa: usaremos el nombre provisto.
      }
    }
    if (!nombre) {
      throw new BadRequestException(
        `No se pudo obtener el nombre del cliente ${numDoc}. Agrega la columna ClienteNombre.`,
      );
    }

    const creado = await this.clienteService.crear({
      nombre,
      tipoDoc: tipoDoc as 'DNI' | 'RUC',
      nroDoc: numDoc,
      empresaId,
      direccion,
      ubigeo,
      departamento,
      provincia,
      distrito,
      persona: 'CLIENTE',
    });
    return { clienteId: creado.id };
  }

  // ---------------------------------------------------------------------------
  // Crear UNA Nota de venta importada
  // ---------------------------------------------------------------------------
  async importarUno(
    empresaId: number,
    usuarioId: number | undefined,
    sedeId: number | undefined,
    dto: ImportarNotaVentaDto,
    indice?: {
      porCodigo: Map<string, number>;
      porBarras: Map<string, number>;
      porDescripcion: Map<string, number>;
    },
  ) {
    const idx = indice ?? (await this.construirIndiceProductos(empresaId));

    const detalles = dto.detalles.map((d) => {
      const productoId = this.resolverProductoId(
        idx,
        d.productoCodigo,
        d.descripcion,
      );
      return {
        productoId,
        descripcion: d.descripcion ?? undefined,
        cantidad: Number(d.cantidad),
        nuevoValorUnitario: Number(d.precioUnitario),
      };
    });

    const cliente = await this.resolverCliente(
      empresaId,
      dto.clienteNumDoc,
      dto.clienteTipoDoc,
      dto.clienteNombre,
    );

    const estadoPago = String(dto.estadoPago ?? 'PAGADO').trim().toUpperCase();
    const esPendiente = ['PENDIENTE', 'PENDIENTE_PAGO', 'CREDITO'].includes(
      estadoPago,
    );

    const input: any = {
      tipoDoc: 'NV',
      serie: dto.serie,
      correlativo: dto.correlativo,
      fechaEmision: dto.fechaEmision,
      tipoMoneda: 'PEN',
      formaPagoMoneda: 'PEN',
      formaPagoTipo: esPendiente ? 'CREDITO' : 'CONTADO',
      medioPago: dto.medioPago ?? 'EFECTIVO',
      clienteId: cliente.clienteId,
      clienteName: cliente.clienteName,
      leyenda: '',
      detalles,
    };

    return this.comprobanteService.crearInformal(
      input,
      empresaId,
      usuarioId,
      sedeId,
      {
        importado: true,
        afectarStock: dto.afectarStock === true,
        afectarCaja: dto.afectarCaja === true,
        serie: dto.serie,
        correlativo: dto.correlativo,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Carga masiva desde Excel/CSV
  // ---------------------------------------------------------------------------
  async importarLote(
    empresaId: number,
    usuarioId: number | undefined,
    sedeId: number | undefined,
    buffer: Buffer,
    flags: { afectarStock: boolean; afectarCaja: boolean },
  ): Promise<ResultadoImportNV> {
    const filas = this.leerFilas(buffer);
    if (filas.length === 0) {
      throw new BadRequestException('El archivo no contiene filas de datos.');
    }

    // Agrupar filas por Serie + Correlativo (cada grupo = una Nota de venta).
    const grupos = new Map<
      string,
      { dto: ImportarNotaVentaDto; primeraFila: number }
    >();
    const erroresPrevios: ResultadoImportNV['detalleErrores'] = [];

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const nFila = i + 2; // +2: encabezado + base 1
      const serie = this.pick(fila, ['serie']);
      const correlativo = this.pick(fila, [
        'correlativo',
        'numero',
        'nro',
        'number',
      ]);
      if (!serie || !correlativo) {
        erroresPrevios.push({
          fila: nFila,
          motivo: 'Faltan Serie o Correlativo.',
        });
        continue;
      }
      const cantidad = Number(this.pick(fila, ['cantidad', 'cant', 'qty']));
      const precioUnitario = Number(
        this.pick(fila, [
          'preciounitario',
          'precio',
          'preciounit',
          'punitario',
        ]),
      );
      const productoCodigo = this.pick(fila, [
        'productocodigo',
        'codigo',
        'codigoproducto',
        'codigobarras',
        'codbarras',
      ]);
      const descripcion = this.pick(fila, [
        'productodescripcion',
        'descripcion',
        'producto',
        'item',
      ]);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        erroresPrevios.push({
          fila: nFila,
          documento: `${serie}-${correlativo}`,
          motivo: 'Cantidad inválida.',
        });
        continue;
      }
      if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
        erroresPrevios.push({
          fila: nFila,
          documento: `${serie}-${correlativo}`,
          motivo: 'PrecioUnitario inválido.',
        });
        continue;
      }

      const key = `${String(serie).trim().toUpperCase()}||${String(correlativo).trim()}`;
      const detalle = {
        productoCodigo: productoCodigo ? String(productoCodigo) : undefined,
        descripcion: descripcion ? String(descripcion) : undefined,
        cantidad,
        precioUnitario,
      };

      const existente = grupos.get(key);
      if (existente) {
        existente.dto.detalles.push(detalle);
      } else {
        grupos.set(key, {
          primeraFila: nFila,
          dto: {
            tipoDoc: 'NV',
            serie: String(serie).trim(),
            correlativo: String(correlativo).trim(),
            fechaEmision: this.normalizarFecha(
              this.pick(fila, ['fechaemision', 'fecha']),
            ),
            clienteNumDoc: this.pick(fila, [
              'clientenumdoc',
              'numerodocumento',
              'nrodoc',
              'documento',
              'ruc',
              'dni',
              'rucdni',
            ]),
            clienteTipoDoc: this.pick(fila, [
              'clientetipodoc',
              'tipodoc',
              'tipodocumento',
            ]),
            clienteNombre: this.pick(fila, [
              'clientenombre',
              'cliente',
              'nombrecliente',
              'razonsocial',
            ]),
            medioPago: this.pick(fila, ['mediopago', 'formapago']),
            estadoPago: this.pick(fila, ['estadopago', 'estado']),
            afectarStock: flags.afectarStock,
            afectarCaja: flags.afectarCaja,
            detalles: [detalle],
          },
        });
      }
    }

    const idx = await this.construirIndiceProductos(empresaId);
    const res: ResultadoImportNV = {
      total: grupos.size,
      importados: 0,
      conError: 0,
      detalleImportados: [],
      detalleErrores: [...erroresPrevios],
    };

    for (const [, grupo] of grupos) {
      const documento = `${grupo.dto.serie}-${grupo.dto.correlativo}`;
      try {
        const comp = await this.importarUno(
          empresaId,
          usuarioId,
          sedeId,
          grupo.dto,
          idx,
        );
        res.importados++;
        res.detalleImportados.push({ documento, comprobanteId: comp.id });
      } catch (e: any) {
        res.detalleErrores.push({
          fila: grupo.primeraFila,
          documento,
          motivo: e?.message || 'Error al importar la nota de venta.',
        });
      }
    }
    res.conError = res.detalleErrores.length;
    return res;
  }

  /** Normaliza la fecha a YYYY-MM-DD (acepta Date, serial de Excel ya formateado, o dd/mm/yyyy). */
  private normalizarFecha(v: any): string {
    if (v == null || String(v).trim() === '') {
      return new Date().toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    // dd/mm/yyyy o dd-mm-yyyy
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) {
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      return `${m[3]}-${mm}-${dd}`;
    }
    // yyyy-mm-dd (con o sin tiempo)
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return new Date().toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // Plantilla descargable
  // ---------------------------------------------------------------------------
  plantilla(): Buffer {
    const ejemplo = [
      {
        Serie: 'NV01',
        Correlativo: '1',
        FechaEmision: '2026-01-15',
        ClienteTipoDoc: 'DNI',
        ClienteNumDoc: '44556677',
        ClienteNombre: 'JUAN PEREZ',
        MedioPago: 'EFECTIVO',
        EstadoPago: 'PAGADO',
        ProductoCodigo: 'P001',
        ProductoDescripcion: 'Producto de ejemplo',
        Cantidad: 2,
        PrecioUnitario: 15.5,
      },
      {
        Serie: 'NV01',
        Correlativo: '1',
        FechaEmision: '2026-01-15',
        ClienteTipoDoc: 'DNI',
        ClienteNumDoc: '44556677',
        ClienteNombre: 'JUAN PEREZ',
        MedioPago: 'EFECTIVO',
        EstadoPago: 'PAGADO',
        ProductoCodigo: 'P002',
        ProductoDescripcion: 'Segundo producto de la misma nota',
        Cantidad: 1,
        PrecioUnitario: 40,
      },
      {
        Serie: 'NV01',
        Correlativo: '2',
        FechaEmision: '2026-01-16',
        ClienteTipoDoc: 'RUC',
        ClienteNumDoc: '20123456789',
        ClienteNombre: 'EMPRESA DEMO SAC',
        MedioPago: 'YAPE',
        EstadoPago: 'PENDIENTE',
        ProductoCodigo: 'P003',
        ProductoDescripcion: 'Otra nota de venta',
        Cantidad: 3,
        PrecioUnitario: 12,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(ejemplo);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'NotasDeVenta');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  }
}
