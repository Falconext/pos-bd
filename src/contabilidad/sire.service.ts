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

  private inferTipoDocIdentidad(nroDoc: string, tipoDocCodigo?: string): string {
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
    const inicio = new Date(`${anio}-${String(mes).padStart(2, '0')}-01T00:00:00.000-05:00`);
    const lastDay = new Date(anio, mes, 0).getDate();
    const fin = new Date(
      `${anio}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999-05:00`,
    );
    return { gte: inicio, lte: fin };
  }

  private getNombreArchivo(tipo: 'ventas' | 'compras', mes: number, anio: number, ext: string): string {
    const periodo = `${anio}${String(mes).padStart(2, '0')}`;
    return `SIRE_${tipo === 'ventas' ? 'RVIE' : 'RCE'}_${periodo}.${ext}`;
  }

  // ──────────────── VENTAS (RVIE) ────────────────

  private async fetchVentas(empresaId: number, mes: number, anio: number, empresarial: boolean, sedeId?: number) {
    const fechaEmision = this.getDateRange(mes, anio);
    return this.prisma.comprobante.findMany({
      where: {
        empresaId,
        ...(empresarial || !sedeId ? {} : { sedeId }),
        tipoDoc: { in: ['01', '03', '07', '08'] },
        fechaEmision,
        estadoEnvioSunat: { not: 'PENDIENTE' as any },
      },
      orderBy: { fechaEmision: 'asc' },
      select: {
        id: true,
        tipoDoc: true,
        serie: true,
        correlativo: true,
        fechaEmision: true,
        tipoMoneda: true,
        mtoOperGravadas: true,
        mtoIGV: true,
        mtoOperInafectas: true,
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
    simple: boolean,
    empresarial: boolean,
    sedeId?: number,
  ): Promise<Buffer> {
    const comprobantes = await this.fetchVentas(empresaId, mes, anio, empresarial, sedeId);
    const periodo = this.getPeriodo(mes, anio);
    const lines: string[] = [];

    for (const c of comprobantes) {
      const cuo = String(c.id).padStart(10, '0');
      const fecEmision = this.formatFecha(c.fechaEmision);
      const tipoDocCliente = this.inferTipoDocIdentidad(
        c.cliente?.nroDoc ?? '',
        c.cliente?.tipoDocumento?.codigo,
      );
      const nroDocCliente = c.cliente?.nroDoc ?? '';
      const razonSocial = (c.cliente?.nombre ?? '').replace(/\|/g, ' ');
      const baseGravadas = this.fmt(c.mtoOperGravadas);
      const igv = this.fmt(c.mtoIGV);
      const inafectas = this.fmt(c.mtoOperInafectas);
      const total = this.fmt(c.mtoImpVenta);
      const tipoCambio = c.tipoMoneda === 'USD' ? '' : '1.000';
      const tipRef = c.tipDocAfectado ?? '';
      const nroRef = c.numDocAfectado ?? '';
      const estado = (c.estadoEnvioSunat as any) === 'ANULADO' ? '6' : '1';

      if (simple) {
        lines.push(
          [
            periodo, cuo, '', fecEmision, '',
            c.tipoDoc, c.serie, String(c.correlativo),
            tipoDocCliente, nroDocCliente, razonSocial,
            '0.00', baseGravadas, '0.00', igv, '0.00',
            '0.00', inafectas,
            total, estado,
          ].join('|'),
        );
      } else {
        // Formato RVIE 14.1 — 33 campos
        lines.push(
          [
            periodo,              // 1  Período
            cuo,                  // 2  CUO
            '',                   // 3  Correlativo asiento
            fecEmision,           // 4  Fecha emisión
            '',                   // 5  Fecha vencimiento
            c.tipoDoc,            // 6  Tipo CDP
            c.serie,              // 7  Serie
            String(c.correlativo),// 8  Número
            tipoDocCliente,       // 9  Tipo doc identidad cliente
            nroDocCliente,        // 10 Nro doc cliente
            razonSocial,          // 11 Razón social
            '0.00',               // 12 Exportación
            baseGravadas,         // 13 Base imp. gravadas
            '0.00',               // 14 Dcto. base imp.
            igv,                  // 15 IGV / IPM
            '0.00',               // 16 Dcto. IGV
            '0.00',               // 17 Exoneradas
            inafectas,            // 18 Inafectas
            '0.00',               // 19 ISC
            '0.00',               // 20 Base IVAP
            '0.00',               // 21 IVAP
            '0.00',               // 22 ICBPER
            '0.00',               // 23 Otros tributos
            total,                // 24 Importe total
            tipoCambio,           // 25 Tipo de cambio
            '',                   // 26 Fecha CDP referencia
            tipRef,               // 27 Tipo CDP referencia
            nroRef,               // 28 Nro CDP referencia
            '',                   // 29 ID contrato
            '0',                  // 30 Indicador pago beneficio
            estado,               // 31 Estado
            '',                   // 32 Código error
            '1',                  // 33 Indicador medio pago
          ].join('|'),
        );
      }
    }

    return Buffer.from(lines.join('\r\n'), 'utf-8');
  }

  async generarExcelVentas(
    empresaId: number,
    mes: number,
    anio: number,
    simple: boolean,
    empresarial: boolean,
    sedeId?: number,
  ): Promise<Buffer> {
    const comprobantes = await this.fetchVentas(empresaId, mes, anio, empresarial, sedeId);
    const periodo = this.getPeriodo(mes, anio);

    const rows = comprobantes.map((c) => {
      const tipoDocCliente = this.inferTipoDocIdentidad(
        c.cliente?.nroDoc ?? '',
        c.cliente?.tipoDocumento?.codigo,
      );
      const estado = (c.estadoEnvioSunat as any) === 'ANULADO' ? '6' : '1';

      if (simple) {
        return {
          PERIODO: periodo,
          CUO: String(c.id).padStart(10, '0'),
          'FECHA EMISIÓN': this.formatFecha(c.fechaEmision),
          'TIPO CDP': c.tipoDoc,
          SERIE: c.serie,
          NÚMERO: c.correlativo,
          'TIPO DOC CLIENTE': tipoDocCliente,
          'NRO DOC CLIENTE': c.cliente?.nroDoc ?? '',
          'RAZÓN SOCIAL': c.cliente?.nombre ?? '',
          'BASE GRAVADA': +(c.mtoOperGravadas ?? 0).toFixed(2),
          IGV: +(c.mtoIGV ?? 0).toFixed(2),
          INAFECTAS: +(c.mtoOperInafectas ?? 0).toFixed(2),
          'IMPORTE TOTAL': +(c.mtoImpVenta ?? 0).toFixed(2),
          ESTADO: estado,
        };
      }

      return {
        PERÍODO: periodo,
        CUO: String(c.id).padStart(10, '0'),
        'CORR. ASIENTO': '',
        'FECHA EMISIÓN': this.formatFecha(c.fechaEmision),
        'FECHA VENCIM.': '',
        'TIPO CDP': c.tipoDoc,
        SERIE: c.serie,
        NÚMERO: c.correlativo,
        'TIPO DOC CLIENTE': tipoDocCliente,
        'NRO DOC CLIENTE': c.cliente?.nroDoc ?? '',
        'RAZÓN SOCIAL': c.cliente?.nombre ?? '',
        'EXPORTACIÓN': 0,
        'BASE GRAVADA': +(c.mtoOperGravadas ?? 0).toFixed(2),
        'DCTO. BASE IMP.': 0,
        IGV: +(c.mtoIGV ?? 0).toFixed(2),
        'DCTO. IGV': 0,
        EXONERADAS: 0,
        INAFECTAS: +(c.mtoOperInafectas ?? 0).toFixed(2),
        ISC: 0,
        'BASE IVAP': 0,
        IVAP: 0,
        ICBPER: 0,
        'OTROS TRIBUTOS': 0,
        'IMPORTE TOTAL': +(c.mtoImpVenta ?? 0).toFixed(2),
        'TIPO CAMBIO': c.tipoMoneda === 'USD' ? '' : 1,
        'FECHA CDP REF.': '',
        'TIPO CDP REF.': c.tipDocAfectado ?? '',
        'NRO CDP REF.': c.numDocAfectado ?? '',
        ESTADO: estado,
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0] ?? {}).map((k) => ({ wch: Math.max(k.length, 12) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Libro Ventas');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  }

  // ──────────────── COMPRAS (RCE) ────────────────

  private async fetchCompras(empresaId: number, mes: number, anio: number, sedeId?: number) {
    const fechaEmision = this.getDateRange(mes, anio);
    return this.prisma.compra.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        fechaEmision,
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
    simple: boolean,
    sedeId?: number,
  ): Promise<Buffer> {
    const compras = await this.fetchCompras(empresaId, mes, anio, sedeId);
    const periodo = this.getPeriodo(mes, anio);
    const lines: string[] = [];

    for (const c of compras) {
      const cuo = String(c.id).padStart(10, '0');
      const fecEmision = this.formatFecha(c.fechaEmision);
      const fecVcto = this.formatFecha(c.fechaVencimiento ?? null);
      const tipoDocSunat = TIPO_DOC_COMPRA_MAP[c.tipoDoc] ?? '01';
      const tipoDocProveedor = this.inferTipoDocIdentidad(
        c.proveedor?.nroDoc ?? '',
        c.proveedor?.tipoDocumento?.codigo,
      );
      const nroDocProveedor = c.proveedor?.nroDoc ?? '';
      const razonSocial = (c.proveedor?.nombre ?? '').replace(/\|/g, ' ');
      const igvN = Number(c.igv ?? 0);
      const subtotalN = Number(c.subtotal ?? 0);
      const totalN = Number(c.total ?? 0);
      const baseGravada = this.fmt(subtotalN);
      const igvStr = this.fmt(igvN);
      const totalStr = this.fmt(totalN);
      const tipoCambio = (c.moneda ?? 'PEN') === 'USD' ? this.fmt(Number(c.tipoCambio ?? 1)) : '1.000';

      if (simple) {
        lines.push(
          [
            periodo, cuo, '', fecEmision, fecVcto,
            tipoDocSunat, c.serie, '', c.numero,
            tipoDocProveedor, nroDocProveedor, razonSocial,
            baseGravada, igvStr,
            '0.00', '0.00', '0.00', '0.00',
            '0.00', '0.00', '0.00', '0.00',
            totalStr, '1',
          ].join('|'),
        );
      } else {
        // Formato RCE 8.1 — 33 campos
        lines.push(
          [
            periodo,          // 1  Período
            cuo,              // 2  CUO
            '',               // 3  Correlativo asiento
            fecEmision,       // 4  Fecha emisión
            fecVcto,          // 5  Fecha vencimiento
            tipoDocSunat,     // 6  Tipo CDP
            c.serie,          // 7  Serie
            '',               // 8  Año DUA/DSI
            c.numero,         // 9  Número
            tipoDocProveedor, // 10 Tipo doc proveedor
            nroDocProveedor,  // 11 Nro doc proveedor
            razonSocial,      // 12 Razón social
            baseGravada,      // 13 Base adq. gravadas (op. gravadas)
            igvStr,           // 14 IGV adq. gravadas (op. gravadas)
            '0.00',           // 15 Base adq. gravadas (op. gravadas y no gravadas)
            '0.00',           // 16 IGV adq. gravadas (op. gravadas y no gravadas)
            '0.00',           // 17 Base adq. gravadas (op. no gravadas)
            '0.00',           // 18 IGV adq. gravadas (op. no gravadas)
            '0.00',           // 19 Valor adq. no gravadas
            '0.00',           // 20 ISC
            '0.00',           // 21 ICBPER
            '0.00',           // 22 Otros tributos
            totalStr,         // 23 Total
            tipoCambio,       // 24 Tipo de cambio
            '',               // 25 Fecha CDP referencia
            '',               // 26 Tipo CDP referencia
            '',               // 27 Nro CDP referencia
            '',               // 28 Nro constancia detracción
            '',               // 29 Fecha constancia detracción
            '',               // 30 Indicador anticipo
            '',               // 31 Período crédito fiscal
            '1',              // 32 Estado
            '',               // 33 Código error
          ].join('|'),
        );
      }
    }

    return Buffer.from(lines.join('\r\n'), 'utf-8');
  }

  async generarExcelCompras(
    empresaId: number,
    mes: number,
    anio: number,
    simple: boolean,
    sedeId?: number,
  ): Promise<Buffer> {
    const compras = await this.fetchCompras(empresaId, mes, anio, sedeId);
    const periodo = this.getPeriodo(mes, anio);

    const rows = compras.map((c) => {
      const tipoDocSunat = TIPO_DOC_COMPRA_MAP[c.tipoDoc] ?? '01';
      const tipoDocProveedor = this.inferTipoDocIdentidad(
        c.proveedor?.nroDoc ?? '',
        c.proveedor?.tipoDocumento?.codigo,
      );
      const subtotalN = Number(c.subtotal ?? 0);
      const igvN = Number(c.igv ?? 0);
      const totalN = Number(c.total ?? 0);

      if (simple) {
        return {
          PERIODO: periodo,
          CUO: String(c.id).padStart(10, '0'),
          'FECHA EMISIÓN': this.formatFecha(c.fechaEmision),
          'FECHA VENCIM.': this.formatFecha(c.fechaVencimiento ?? null),
          'TIPO CDP': tipoDocSunat,
          SERIE: c.serie,
          NÚMERO: c.numero,
          'TIPO DOC PROVEEDOR': tipoDocProveedor,
          'NRO DOC PROVEEDOR': c.proveedor?.nroDoc ?? '',
          'RAZÓN SOCIAL PROVEEDOR': c.proveedor?.nombre ?? '',
          'BASE GRAVADA': +subtotalN.toFixed(2),
          IGV: +igvN.toFixed(2),
          'IMPORTE TOTAL': +totalN.toFixed(2),
          ESTADO: '1',
        };
      }

      return {
        PERÍODO: periodo,
        CUO: String(c.id).padStart(10, '0'),
        'CORR. ASIENTO': '',
        'FECHA EMISIÓN': this.formatFecha(c.fechaEmision),
        'FECHA VENCIM.': this.formatFecha(c.fechaVencimiento ?? null),
        'TIPO CDP': tipoDocSunat,
        SERIE: c.serie,
        'AÑO DUA/DSI': '',
        NÚMERO: c.numero,
        'TIPO DOC PROVEEDOR': tipoDocProveedor,
        'NRO DOC PROVEEDOR': c.proveedor?.nroDoc ?? '',
        'RAZÓN SOCIAL': c.proveedor?.nombre ?? '',
        'BASE ADQ. GRAVADAS': +subtotalN.toFixed(2),
        'IGV ADQ. GRAVADAS': +igvN.toFixed(2),
        'BASE ADQ. GRAV. (MX)': 0,
        'IGV ADQ. GRAV. (MX)': 0,
        'BASE ADQ. GRAV. (NG)': 0,
        'IGV ADQ. GRAV. (NG)': 0,
        'ADQ. NO GRAVADAS': 0,
        ISC: 0,
        ICBPER: 0,
        'OTROS TRIBUTOS': 0,
        'IMPORTE TOTAL': +totalN.toFixed(2),
        'TIPO CAMBIO': (c.moneda ?? 'PEN') === 'USD' ? +(c.tipoCambio ?? 1) : 1,
        'FECHA CDP REF.': '',
        'TIPO CDP REF.': '',
        'NRO CDP REF.': '',
        'NRO CONSTANCIA DET.': '',
        'FECHA CONSTANCIA DET.': '',
        'PERÍODO CRÉDITO': '',
        ESTADO: '1',
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0] ?? {}).map((k) => ({ wch: Math.max(k.length, 12) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Registro Compras');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  }

  // ──────────────── EMAIL ────────────────

  async enviarPorCorreo(params: {
    tipo: 'ventas' | 'compras';
    mes: number;
    anio: number;
    simple: boolean;
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

    const { tipo, mes, anio, simple, empresarial, empresaId, destinatario, sedeId } = params;

    let txtBuffer: Buffer;
    let xlsxBuffer: Buffer;

    if (tipo === 'ventas') {
      txtBuffer = await this.generarTxtVentas(empresaId, mes, anio, simple, empresarial ?? false, sedeId);
      xlsxBuffer = await this.generarExcelVentas(empresaId, mes, anio, simple, empresarial ?? false, sedeId);
    } else {
      txtBuffer = await this.generarTxtCompras(empresaId, mes, anio, simple, sedeId);
      xlsxBuffer = await this.generarExcelCompras(empresaId, mes, anio, simple, sedeId);
    }

    const nombreTxt = this.getNombreArchivo(tipo, mes, anio, 'txt');
    const nombreXlsx = this.getNombreArchivo(tipo, mes, anio, 'xlsx');
    const label = tipo === 'ventas' ? 'Libro Electrónico de Ventas (RVIE)' : 'Registro de Compras (RCE)';
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
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
    });
  }
}
