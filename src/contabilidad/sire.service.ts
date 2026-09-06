import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as XLSX from 'xlsx';
import * as nodemailer from 'nodemailer';

// Map compras tipoDoc text → SUNAT código catálogo 01
const TIPO_DOC_COMPRA_MAP: Record<string, string> = {
  FACTURA: '01',
  BOLETA: '03',
  RECIBO_HONORARIOS: '02',
  LIQUIDACION: '04',
  TICKET: '03',
  NOTA_DEBITO: '08',
  NOTA_CREDITO: '07',
};

@Injectable()
export class SireService {
  constructor(private readonly prisma: PrismaService) {}

  // ──────────────── Helpers ────────────────

  private formatFecha(date: Date | null | undefined): string {
    if (!date) return '';
    const d = new Date(date.getTime() - 5 * 60 * 60 * 1000);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  private getPeriodo(mes: number, anio: number): string {
    return `${anio}${String(mes).padStart(2, '0')}00`;
  }

  /**
   * Periodo del SIRE: AAAAMM (6 dígitos), campo 3 del RVIE y del RCE.
   * OJO: el PLE antiguo usaba AAAAMM00 (8 dígitos con el día en '00'); el
   * SIRE NO lleva ese sufijo. Ver RS 000112-2021/SUNAT anexo 2/3 campo 3.
   */
  private periodoSire(mes: number, anio: number): string {
    return `${anio}${String(mes).padStart(2, '0')}`;
  }

  /** Fecha en formato AAAA-MM-DD (RVIE campo 29: doc. modificado). */
  private formatFechaIso(date: Date | null | undefined): string {
    if (!date) return '';
    const d = new Date(date.getTime() - 5 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Texto libre entre palotes. La norma prohíbe los caracteres | / \ dentro
   * de los campos de texto (RS 112-2021, reglas generales del archivo).
   */
  private texto(val: string | null | undefined): string {
    return (val ?? '').replace(/[|/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Los comprobantes guardan el documento afectado como "SERIE-NUMERO"
   * (p. ej. "F0A1-316"), pero el SIRE exige serie y número en campos
   * separados. Se parte por el último guion para no romper series que lo
   * contengan.
   */
  private splitSerieNumero(ref: string | null | undefined): [string, string] {
    const val = (ref ?? '').trim();
    if (!val) return ['', ''];
    const i = val.lastIndexOf('-');
    if (i <= 0) return [val, ''];
    return [val.slice(0, i), val.slice(i + 1)];
  }

  private inferTipoDocIdentidad(
    nroDoc: string,
    tipoDocCodigo?: string,
  ): string {
    if (tipoDocCodigo) return tipoDocCodigo;
    if (!nroDoc) return '0';
    const clean = nroDoc.replace(/\D/g, '');
    if (clean.length === 11) return '6'; // RUC
    if (clean.length === 8) return '1'; // DNI
    return '0';
  }

  private fmt(val: number | null | undefined): string {
    return (val ?? 0).toFixed(2);
  }

  private getDateRange(mes: number, anio: number) {
    const inicio = new Date(
      `${anio}-${String(mes).padStart(2, '0')}-01T00:00:00.000-05:00`,
    );
    const lastDay = new Date(anio, mes, 0).getDate();
    const fin = new Date(
      `${anio}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999-05:00`,
    );
    return { gte: inicio, lte: fin };
  }

  private getNombreArchivo(
    tipo: 'ventas' | 'compras',
    mes: number,
    anio: number,
    ext: string,
  ): string {
    const periodo = `${anio}${String(mes).padStart(2, '0')}`;
    return `SIRE_${tipo === 'ventas' ? 'RVIE' : 'RCE'}_${periodo}.${ext}`;
  }

  /**
   * Nombre del TXT según la tabla 6 del anexo 1 (RS 112-2021 para el RVIE y
   * RS 040-2022 para el RCE). SUNAT valida el nombre, no solo el contenido:
   *
   *   LE + RUC(11) + AAAAMM + DD + LLLLLL + CC + O + I + M + G + .TXT
   *
   *   DD     '00' (el RVIE/RCE no es de periodicidad diaria)
   *   LLLLLL identificador del libro: 140400 ventas, 080400 compras
   *   CC     oportunidad: 01 acepta propuesta, 02 reemplaza, 03 ajustes
   *   O      indicador de operaciones: 1 = empresa operativa
   *   I      indicador de contenido: 1 = con información, 0 = sin
   *   M      moneda: 1 = soles, 2 = dólares
   *   G      '2' fijo = generado por el nuevo sistema (MIGE IGV)
   */
  async nombreArchivoTxtSire(
    empresaId: number,
    tipo: 'ventas' | 'compras',
    mes: number,
    anio: number,
    conInformacion: boolean,
  ): Promise<string> {
    const { ruc } = await this.fetchGenerador(empresaId);
    const periodo = this.periodoSire(mes, anio);
    const libro = tipo === 'ventas' ? '140400' : '080400';
    const oportunidad = '02'; // reemplaza la propuesta
    const indOperaciones = '1';
    const indContenido = conInformacion ? '1' : '0';
    const indMoneda = '1'; // contabilidad en soles
    return `LE${ruc}${periodo}00${libro}${oportunidad}${indOperaciones}${indContenido}${indMoneda}2.TXT`;
  }

  /**
   * RUC y razón social del generador: campos 1 y 2 de ambos registros.
   * Son obligatorios en el SIRE y no existían en el formato PLE anterior.
   */
  private async fetchGenerador(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { ruc: true, razonSocial: true },
    });
    if (!empresa?.ruc) {
      throw new BadRequestException(
        'La empresa no tiene RUC configurado: el SIRE lo exige en el campo 1 del archivo.',
      );
    }
    return {
      ruc: empresa.ruc,
      razonSocial: this.texto(empresa.razonSocial),
    };
  }

  // ──────────────── VENTAS (RVIE) ────────────────

  private async fetchVentas(
    empresaId: number,
    mes: number,
    anio: number,
    empresarial: boolean,
    sedeId?: number,
  ) {
    const fechaEmision = this.getDateRange(mes, anio);
    return this.prisma.comprobante.findMany({
      where: {
        empresaId,
        ...(empresarial || !sedeId ? {} : { sedeId }),
        tipoDoc: { in: ['01', '03', '07', '08'] },
        fechaEmision,
        // Excluir no válidos para el Libro de Ventas: PENDIENTE (sin enviar),
        // RECHAZADO y FALLIDO_ENVIO (no aceptados por SUNAT). Antes se colaban como estado '1'.
        estadoEnvioSunat: {
          notIn: ['PENDIENTE', 'RECHAZADO', 'FALLIDO_ENVIO'] as any,
        },
      },
      orderBy: { fechaEmision: 'asc' },
      select: {
        id: true,
        tipoDoc: true,
        serie: true,
        correlativo: true,
        fechaEmision: true,
        tipoMoneda: true,
        tipoCambio: true,
        mtoOperGravadas: true,
        mtoIGV: true,
        mtoOperInafectas: true,
        mtoOperExoneradas: true,
        mtoOperExportacion: true,
        mtoDescuentoGlobal: true,
        mtoImpVenta: true,
        tipDocAfectado: true,
        numDocAfectado: true,
        estadoEnvioSunat: true,
        cliente: {
          select: {
            nombre: true,
            nroDoc: true,
            tipoDocumento: { select: { codigo: true } },
          },
        },
      },
    });
  }

  async generarTxtVentas(
    empresaId: number,
    mes: number,
    anio: number,
    empresarial: boolean,
    sedeId?: number,
  ): Promise<Buffer> {
    const [generador, comprobantes] = await Promise.all([
      this.fetchGenerador(empresaId),
      this.fetchVentas(empresaId, mes, anio, empresarial, sedeId),
    ]);
    const periodo = this.periodoSire(mes, anio);
    // El texto de la RS 112-2021 dice "Formato YYYY-MM-DD" para el campo 29,
    // pero el validador oficial (PVSIRE 1.9.0) lo rechaza con el error 206
    // "Fecha de emisión no contiene el formato establecido" y sí acepta
    // DD/MM/AAAA, igual que el campo 5. Se sigue al validador.
    const fechasDocModificado = await this.fetchFechasDocModificado(
      empresaId,
      comprobantes,
      'ddmmyyyy',
    );
    const lines: string[] = [];

    for (const c of comprobantes) {
      const esNota = c.tipoDoc === '07' || c.tipoDoc === '08';
      // Las notas de crédito (07) reducen el registro: sus montos van en
      // NEGATIVO ("- #.##" según la norma, campos 14 a 26).
      const signo = c.tipoDoc === '07' ? -1 : 1;
      // La norma manda 0.00 para un comprobante "anulado", pero eso aplica a
      // los dados de BAJA ante SUNAT (tabla 9: baja comunicada por el
      // contribuyente). Acá `ANULADO` significa otra cosa: o se anuló
      // internamente, o una nota de crédito de anulación afectó al original
      // (ver comprobante.service.ts:1078 y :4067). En ambos casos el CDR fue
      // aceptado y SUNAT lo sigue contando a valor completo — la reducción la
      // hace la nota de crédito. Ponerlos en 0.00 restaría dos veces: se
      // verificó contra la propuesta RVIE real de SUNAT (07/2026), que cuadra
      // al céntimo informando los montos tal cual. No hay flujo de
      // comunicación de baja en el sistema.
      const monto = (val: number | null | undefined) =>
        this.fmt(Number(val ?? 0) * signo);

      const [serieRef, nroRef] = this.splitSerieNumero(c.numDocAfectado);
      const moneda = c.tipoMoneda || 'PEN';

      // Formato RVIE — 33 campos (RS 000112-2021/SUNAT, anexo 2/3).
      lines.push(
        [
          generador.ruc, //                              1  RUC del generador
          generador.razonSocial, //                      2  Razón social del generador
          periodo, //                                    3  Periodo AAAAMM
          '', //                                         4  CAR (lo completa SUNAT)
          this.formatFecha(c.fechaEmision), //           5  Fecha emisión DD/MM/AAAA
          '', //                                         6  Fecha vencimiento/pago (solo tipo 14)
          c.tipoDoc, //                                  7  Tipo CP
          c.serie, //                                    8  Serie del CDP
          String(c.correlativo), //                      9  Número del CP
          '', //                                        10  Nro final (rango)
          this.inferTipoDocIdentidad(
            c.cliente?.nroDoc ?? '',
            c.cliente?.tipoDocumento?.codigo,
          ), //                                         11  Tipo doc identidad cliente
          c.cliente?.nroDoc ?? '', //                   12  Nro doc identidad cliente
          this.texto(c.cliente?.nombre), //             13  Razón social del cliente
          monto(c.mtoOperExportacion), //               14  Valor facturado exportación
          monto(c.mtoOperGravadas), //                  15  Base imponible gravada
          // 16 Dscto BI: solo aplica en notas que modifican periodos
          // anteriores. mtoOperGravadas ya viene neto del descuento global,
          // así que no se vuelve a restar acá.
          '0.00', //                                    16  Descuento de la base imponible
          monto(c.mtoIGV), //                           17  IGV / IPM
          '0.00', //                                    18  Descuento del IGV
          monto(c.mtoOperExoneradas), //                19  Exonerado
          monto(c.mtoOperInafectas), //                 20  Inafecto
          '0.00', //                                    21  ISC
          '0.00', //                                    22  Base imponible IVAP
          '0.00', //                                    23  IVAP
          '0.00', //                                    24  ICBPER
          '0.00', //                                    25  Otros tributos y cargos
          monto(c.mtoImpVenta), //                      26  Importe total del CP
          moneda, //                                    27  Moneda ISO 4217
          // 28 Tipo de cambio: obligatorio solo si la moneda no es PEN.
          moneda === 'PEN' ? '' : this.fmt(Number(c.tipoCambio ?? 0)),
          esNota ? fechasDocModificado.get(c.id) ?? '' : '', // 29 Fecha doc. modificado AAAA-MM-DD
          esNota ? c.tipDocAfectado ?? '' : '', //      30  Tipo CP modificado
          esNota ? serieRef : '', //                    31  Serie CP modificado
          esNota ? nroRef : '', //                      32  Número CP modificado
          '', //                                        33  ID contrato / proyecto
        ].join('|'),
      );
    }

    // SUNAT exige el TXT en ANSI (Windows-1252/ISO-8859-1), no UTF-8: con
    // UTF-8, cualquier nombre con tilde o Ñ sale corrupto o es rechazado por
    // el validador. 'latin1' cubre correctamente los caracteres del español.
    // Cada línea termina en CRLF, incluida la última.
    return Buffer.from(
      lines.map((l) => `${l}\r\n`).join(''),
      'latin1',
    );
  }

  /**
   * El campo 29 del RVIE (y el 28 del RCE) pide la fecha de emisión del
   * comprobante ORIGINAL que la nota modifica, dato que no se guarda en el
   * comprobante. Se resuelve buscando el documento referenciado en una sola
   * consulta por lote.
   */
  private async fetchFechasDocModificado(
    empresaId: number,
    comprobantes: Array<{
      id: number;
      tipoDoc: string;
      tipDocAfectado?: string | null;
      numDocAfectado?: string | null;
    }>,
    formato: 'iso' | 'ddmmyyyy' = 'iso',
  ): Promise<Map<number, string>> {
    const notas = comprobantes.filter(
      (c) =>
        (c.tipoDoc === '07' || c.tipoDoc === '08') &&
        c.tipDocAfectado &&
        c.numDocAfectado,
    );
    const salida = new Map<number, string>();
    if (!notas.length) return salida;

    const refs = notas.map((n) => {
      const [serie, numero] = this.splitSerieNumero(n.numDocAfectado);
      return { id: n.id, tipoDoc: n.tipDocAfectado as string, serie, numero };
    });

    const originales = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        OR: refs
          .filter((r) => r.serie && /^\d+$/.test(r.numero))
          .map((r) => ({
            tipoDoc: r.tipoDoc,
            serie: r.serie,
            correlativo: Number(r.numero),
          })),
      },
      select: { tipoDoc: true, serie: true, correlativo: true, fechaEmision: true },
    });

    const porClave = new Map(
      originales.map((o) => [
        `${o.tipoDoc}|${o.serie}|${o.correlativo}`,
        o.fechaEmision,
      ]),
    );
    for (const r of refs) {
      const fecha = porClave.get(`${r.tipoDoc}|${r.serie}|${Number(r.numero)}`);
      if (fecha) {
        salida.set(
          r.id,
          formato === 'iso'
            ? this.formatFechaIso(fecha)
            : this.formatFecha(fecha),
        );
      }
    }
    return salida;
  }

  async generarExcelVentas(
    empresaId: number,
    mes: number,
    anio: number,
    empresarial: boolean,
    sedeId?: number,
  ): Promise<Buffer> {
    const [generador, comprobantes] = await Promise.all([
      this.fetchGenerador(empresaId),
      this.fetchVentas(empresaId, mes, anio, empresarial, sedeId),
    ]);
    const periodo = this.periodoSire(mes, anio);
    const fechasDocModificado = await this.fetchFechasDocModificado(
      empresaId,
      comprobantes,
      'ddmmyyyy',
    );

    // El Excel espeja campo por campo el TXT oficial (mismos nombres que la
    // plantilla de SUNAT), para que el contador pueda cuadrar una cosa con la
    // otra sin traducir cabeceras.
    const rows = comprobantes.map((c) => {
      const esNota = c.tipoDoc === '07' || c.tipoDoc === '08';
      const signo = c.tipoDoc === '07' ? -1 : 1;
      const n = (val: any) => +(Number(val ?? 0) * signo).toFixed(2);
      const [serieRef, nroRef] = this.splitSerieNumero(c.numDocAfectado);
      const moneda = c.tipoMoneda || 'PEN';

      return {
        RUC: generador.ruc,
        ID: generador.razonSocial,
        PERIODO: periodo,
        'CAR SUNAT': '',
        'FECHA DE EMISIÓN': this.formatFecha(c.fechaEmision),
        'FECHA VCTO/PAGO': '',
        'TIPO CP/DOC.': c.tipoDoc,
        'SERIE DEL CDP': c.serie,
        'NRO CP O DOC.': c.correlativo,
        'NRO FINAL (RANGO)': '',
        'TIPO DOC IDENTIDAD': this.inferTipoDocIdentidad(
          c.cliente?.nroDoc ?? '',
          c.cliente?.tipoDocumento?.codigo,
        ),
        'NRO DOC IDENTIDAD': c.cliente?.nroDoc ?? '',
        'APELLIDOS NOMBRES/ RAZÓN SOCIAL': this.texto(c.cliente?.nombre),
        'VALOR FACTURADO EXPORTACIÓN': n(c.mtoOperExportacion),
        'BI GRAVADA': n(c.mtoOperGravadas),
        'DSCTO BI': 0,
        'IGV / IPM DG': n(c.mtoIGV),
        'DSCTO IGV / IPM': 0,
        'MTO EXONERADO': n(c.mtoOperExoneradas),
        'MTO INAFECTO': n(c.mtoOperInafectas),
        ISC: 0,
        'BI GRAV IVAP': 0,
        IVAP: 0,
        ICBPER: 0,
        'OTROS TRIBUTOS': 0,
        'TOTAL CP': n(c.mtoImpVenta),
        MONEDA: moneda,
        'TIPO DE CAMBIO': moneda === 'PEN' ? '' : Number(c.tipoCambio ?? 0),
        'FECHA EMISIÓN DOC MODIFICADO': esNota
          ? fechasDocModificado.get(c.id) ?? ''
          : '',
        'TIPO CP MODIFICADO': esNota ? c.tipDocAfectado ?? '' : '',
        'SERIE CP MODIFICADO': esNota ? serieRef : '',
        'NRO CP MODIFICADO': esNota ? nroRef : '',
        'ID PROYECTO OPERADORES ATRIBUCIÓN': '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0] ?? {}).map((k) => ({
      wch: Math.max(k.length, 12),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'RVIE');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  }

  // ──────────────── COMPRAS (RCE) ────────────────

  private async fetchCompras(
    empresaId: number,
    mes: number,
    anio: number,
    sedeId?: number,
  ) {
    const fechaEmision = this.getDateRange(mes, anio);
    return this.prisma.compra.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        fechaEmision,
        // Excluir compras que nunca aplicaron efectos reales: ANULADA,
        // RECHAZADA (el admin la rechazó) y PENDIENTE_APROBACION (aún sin
        // visto bueno, sin stock ni pago). Solo REGISTRADO va al RCE.
        estado: 'REGISTRADO' as any,
      },
      orderBy: { fechaEmision: 'asc' },
      include: {
        proveedor: { include: { tipoDocumento: true } },
      },
    });
  }

  async generarTxtCompras(
    empresaId: number,
    mes: number,
    anio: number,
    sedeId?: number,
  ): Promise<Buffer> {
    const [generador, compras] = await Promise.all([
      this.fetchGenerador(empresaId),
      this.fetchCompras(empresaId, mes, anio, sedeId),
    ]);
    const periodo = this.periodoSire(mes, anio);
    const lines: string[] = [];

    for (const c of compras) {
      const tipoDocSunat = TIPO_DOC_COMPRA_MAP[c.tipoDoc] ?? '01';
      // Las notas de crédito de compra restan crédito fiscal: montos en
      // negativo, igual criterio que en el RVIE.
      const signo = tipoDocSunat === '07' ? -1 : 1;
      const monto = (val: any) => this.fmt(Number(val ?? 0) * signo);
      const moneda = c.moneda || 'PEN';

      // Formato RCE — 37 campos (RS 000040-2022/SUNAT).
      lines.push(
        [
          generador.ruc, //                             1  RUC del generador
          generador.razonSocial, //                     2  Razón social del generador
          periodo, //                                   3  Periodo AAAAMM
          '', //                                        4  CAR (lo completa SUNAT)
          this.formatFecha(c.fechaEmision), //          5  Fecha emisión DD/MM/AAAA
          this.formatFecha(c.fechaVencimiento ?? null), // 6 Fecha vencimiento/pago
          tipoDocSunat, //                              7  Tipo CP
          c.serie, //                                   8  Serie del CDP
          '', //                                        9  Año emisión DAM/DSI (solo importaciones)
          c.numero, //                                 10  Número del CP
          '', //                                       11  Nro final (rango)
          this.inferTipoDocIdentidad(
            c.proveedor?.nroDoc ?? '',
            c.proveedor?.tipoDocumento?.codigo,
          ), //                                        12  Tipo doc identidad proveedor
          c.proveedor?.nroDoc ?? '', //                13  Nro doc identidad proveedor
          this.texto(c.proveedor?.nombre), //          14  Razón social del proveedor
          // Campos 15/16: adquisiciones gravadas destinadas a operaciones
          // gravadas y/o de exportación (el caso normal). Los pares 17/18 y
          // 19/20 son para uso mixto y para compras sin derecho a crédito,
          // que el sistema no discrimina hoy.
          monto(c.subtotal), //                        15  Base imponible gravada (con derecho a crédito)
          monto(c.igv), //                             16  IGV / IPM de la base 15
          '0.00', //                                   17  Base gravada uso mixto
          '0.00', //                                   18  IGV uso mixto
          '0.00', //                                   19  Base gravada sin derecho a crédito
          '0.00', //                                   20  IGV sin derecho a crédito
          '0.00', //                                   21  Valor de adquisiciones no gravadas
          '0.00', //                                   22  ISC
          '0.00', //                                   23  ICBPER
          '0.00', //                                   24  Otros conceptos, tributos y cargos
          monto(c.total), //                           25  Importe total de la adquisición
          moneda, //                                   26  Moneda ISO 4217
          // 27 Tipo de cambio: obligatorio solo si la moneda no es PEN.
          moneda === 'PEN' ? '' : this.fmt(Number(c.tipoCambio ?? 0)),
          // Campos 28 a 32: SUNAT los exige cuando el tipo de CP es nota de
          // crédito o débito (07/08/87/88), pero el modelo Compra no guarda
          // referencia al documento que la nota modifica. Hoy no se dispara
          // (todas las compras registradas son facturas); si algún día se
          // registran notas de compra, hay que agregar esos campos al modelo
          // antes de que el archivo pase la validación de SUNAT.
          '', //                                       28  Fecha emisión doc. modificado DD/MM/AAAA
          '', //                                       29  Tipo CP modificado
          '', //                                       30  Serie CP modificado
          '', //                                       31  Código dependencia aduanera
          '', //                                       32  Número CP modificado
          '', //                                       33  Clasificación de bienes y servicios
          '', //                                       34  ID contrato / proyecto
          '', //                                       35  Porcentaje de participación
          '0.00', //                                   36  Impuesto materia de beneficio (Ley 31053)
          '', //                                       37  CAR original / indicador exclusión-inclusión
        ].join('|'),
      );
    }

    // SUNAT exige el TXT en ANSI (Windows-1252/ISO-8859-1), no UTF-8: con
    // UTF-8, cualquier nombre con tilde o Ñ sale corrupto o es rechazado por
    // el validador. Cada línea termina en CRLF, incluida la última.
    return Buffer.from(lines.map((l) => `${l}\r\n`).join(''), 'latin1');
  }

  async generarExcelCompras(
    empresaId: number,
    mes: number,
    anio: number,
    sedeId?: number,
  ): Promise<Buffer> {
    const [generador, compras] = await Promise.all([
      this.fetchGenerador(empresaId),
      this.fetchCompras(empresaId, mes, anio, sedeId),
    ]);
    const periodo = this.periodoSire(mes, anio);

    // Espeja campo por campo el TXT oficial del RCE (mismos nombres que la
    // plantilla de SUNAT) para poder cuadrar Excel contra TXT.
    const rows = compras.map((c) => {
      const tipoDocSunat = TIPO_DOC_COMPRA_MAP[c.tipoDoc] ?? '01';
      const signo = tipoDocSunat === '07' ? -1 : 1;
      const n = (val: any) => +(Number(val ?? 0) * signo).toFixed(2);
      const moneda = c.moneda || 'PEN';

      return {
        RUC: generador.ruc,
        'APELLIDOS Y NOMBRES O RAZON SOCIAL': generador.razonSocial,
        PERIODO: periodo,
        'CAR SUNAT': '',
        'FECHA DE EMISION': this.formatFecha(c.fechaEmision),
        'FECHA VCTO/PAGO': this.formatFecha(c.fechaVencimiento ?? null),
        'TIPO CP/DOC.': tipoDocSunat,
        'SERIE DEL CDP': c.serie,
        'ANIO': '',
        'NRO CP O DOC.': c.numero,
        'NRO FINAL (RANGO)': '',
        'TIPO DOC IDENTIDAD': this.inferTipoDocIdentidad(
          c.proveedor?.nroDoc ?? '',
          c.proveedor?.tipoDocumento?.codigo,
        ),
        'NRO DOC IDENTIDAD': c.proveedor?.nroDoc ?? '',
        'APELLIDOS NOMBRES/ RAZON SOCIAL': this.texto(c.proveedor?.nombre),
        'BI GRAVADO DG': n(c.subtotal),
        'IGV / IPM DG': n(c.igv),
        'BI GRAVADO DGNG': 0,
        'IGV / IPM DGNG': 0,
        'BI GRAVADO DNG': 0,
        'IGV / IPM DNG': 0,
        'VALOR ADQ. NG': 0,
        ISC: 0,
        ICBPER: 0,
        'OTROS TRIB/ CARGOS': 0,
        'TOTAL CP': n(c.total),
        MONEDA: moneda,
        'TIPO DE CAMBIO': moneda === 'PEN' ? '' : Number(c.tipoCambio ?? 0),
        'FECHA EMISION DOC MODIFICADO': '',
        'TIPO CP MODIFICADO': '',
        'SERIE CP MODIFICADO': '',
        'COD. DAM O DSI': '',
        'NRO CP MODIFICADO': '',
        'CLASIF DE BSS Y SSS': '',
        'ID PROYECTO OPERADORES/PARTICIPES': '',
        PORCPART: '',
        IMB: 0,
        'CAR ORIG': '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0] ?? {}).map((k) => ({
      wch: Math.max(k.length, 12),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'RCE');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  }

  // ──────────────── RESÚMENES (previsualización) ────────────────

  private r2(n: number): number {
    return Number((n || 0).toFixed(2));
  }

  /**
   * Totales del Libro de Ventas del período. Se calcula con la MISMA consulta
   * (fetchVentas) y los mismos criterios de signo que el TXT/Excel, para que
   * el usuario pueda cuadrar en pantalla antes de exportar a SUNAT.
   */
  async obtenerResumenVentas(
    empresaId: number,
    mes: number,
    anio: number,
    empresarial: boolean,
    sedeId?: number,
  ) {
    const comprobantes = await this.fetchVentas(
      empresaId,
      mes,
      anio,
      empresarial,
      sedeId,
    );

    let gravadas = 0;
    let igv = 0;
    let exoneradas = 0;
    let inafectas = 0;
    let exportacion = 0;
    let total = 0;
    let anulados = 0;
    let notasCredito = 0;
    const porTipoDoc: Record<string, { cantidad: number; total: number }> = {};

    for (const c of comprobantes) {
      // Mismo criterio que el TXT: las notas de crédito (07) restan.
      const signo = c.tipoDoc === '07' ? -1 : 1;
      if (signo === -1) notasCredito++;
      if ((c.estadoEnvioSunat as any) === 'ANULADO') anulados++;

      gravadas += Number(c.mtoOperGravadas ?? 0) * signo;
      igv += Number(c.mtoIGV ?? 0) * signo;
      exoneradas += Number(c.mtoOperExoneradas ?? 0) * signo;
      inafectas += Number(c.mtoOperInafectas ?? 0) * signo;
      exportacion += Number(c.mtoOperExportacion ?? 0) * signo;
      const importe = Number(c.mtoImpVenta ?? 0) * signo;
      total += importe;

      const tipo = c.tipoDoc ?? '';
      if (!porTipoDoc[tipo]) porTipoDoc[tipo] = { cantidad: 0, total: 0 };
      porTipoDoc[tipo].cantidad++;
      porTipoDoc[tipo].total = this.r2(porTipoDoc[tipo].total + importe);
    }

    return {
      periodo: `${anio}${String(mes).padStart(2, '0')}`,
      cantidad: comprobantes.length,
      gravadas: this.r2(gravadas),
      igv: this.r2(igv),
      exoneradas: this.r2(exoneradas),
      inafectas: this.r2(inafectas),
      exportacion: this.r2(exportacion),
      total: this.r2(total),
      anulados,
      notasCredito,
      porTipoDoc,
    };
  }

  /**
   * Totales del Registro de Compras del período, con la misma consulta
   * (fetchCompras) que alimenta el TXT/Excel — solo compras REGISTRADO.
   */
  async obtenerResumenCompras(
    empresaId: number,
    mes: number,
    anio: number,
    sedeId?: number,
  ) {
    const compras = await this.fetchCompras(empresaId, mes, anio, sedeId);

    let base = 0;
    let igv = 0;
    let total = 0;
    const porTipoDoc: Record<string, { cantidad: number; total: number }> = {};

    for (const c of compras) {
      base += Number(c.subtotal ?? 0);
      igv += Number(c.igv ?? 0);
      const importe = Number(c.total ?? 0);
      total += importe;

      const tipo = TIPO_DOC_COMPRA_MAP[c.tipoDoc] ?? '01';
      if (!porTipoDoc[tipo]) porTipoDoc[tipo] = { cantidad: 0, total: 0 };
      porTipoDoc[tipo].cantidad++;
      porTipoDoc[tipo].total = this.r2(porTipoDoc[tipo].total + importe);
    }

    return {
      periodo: `${anio}${String(mes).padStart(2, '0')}`,
      cantidad: compras.length,
      base: this.r2(base),
      igv: this.r2(igv),
      total: this.r2(total),
      porTipoDoc,
    };
  }

  // ──────────────── EMAIL ────────────────

  async enviarPorCorreo(params: {
    tipo: 'ventas' | 'compras';
    mes: number;
    anio: number;
    empresarial?: boolean;
    empresaId: number;
    destinatario: string;
    sedeId?: number;
  }): Promise<void> {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT ?? '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

    if (!smtpHost || !smtpUser || !smtpPass) {
      throw new BadRequestException(
        'El servidor de correo no está configurado. Agrega SMTP_HOST, SMTP_USER y SMTP_PASS en el archivo .env',
      );
    }

    const {
      tipo,
      mes,
      anio,
      empresarial,
      empresaId,
      destinatario,
      sedeId,
    } = params;

    let txtBuffer: Buffer;
    let xlsxBuffer: Buffer;

    if (tipo === 'ventas') {
      txtBuffer = await this.generarTxtVentas(
        empresaId,
        mes,
        anio,
        empresarial ?? false,
        sedeId,
      );
      xlsxBuffer = await this.generarExcelVentas(
        empresaId,
        mes,
        anio,
        empresarial ?? false,
        sedeId,
      );
    } else {
      txtBuffer = await this.generarTxtCompras(
        empresaId,
        mes,
        anio,
        sedeId,
      );
      xlsxBuffer = await this.generarExcelCompras(
        empresaId,
        mes,
        anio,
        sedeId,
      );
    }

    const nombreTxt = this.getNombreArchivo(tipo, mes, anio, 'txt');
    const nombreXlsx = this.getNombreArchivo(tipo, mes, anio, 'xlsx');
    const label =
      tipo === 'ventas'
        ? 'Libro Electrónico de Ventas (RVIE)'
        : 'Registro de Compras (RCE)';
    const periodo = `${String(mes).padStart(2, '0')}/${anio}`;

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
      from: `"Falconext SIRE" <${smtpFrom}>`,
      to: destinatario,
      subject: `SIRE - ${label} | Período ${periodo}`,
      html: `
        <p>Estimado(a),</p>
        <p>Adjunto encontrará el <strong>${label}</strong> correspondiente al período <strong>${periodo}</strong>.</p>
        <p>Se adjuntan dos archivos:</p>
        <ul>
          <li><strong>${nombreTxt}</strong> — Formato TXT para importar en el sistema SIRE de SUNAT.</li>
          <li><strong>${nombreXlsx}</strong> — Versión Excel para revisión.</li>
        </ul>
        <p>Generado por <strong>Falconext MyPE</strong>.</p>
      `,
      attachments: [
        { filename: nombreTxt, content: txtBuffer, contentType: 'text/plain' },
        {
          filename: nombreXlsx,
          content: xlsxBuffer,
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
    });
  }
}
