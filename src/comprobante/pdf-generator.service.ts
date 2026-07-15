import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PdfGeneratorService {
  private readonly logger = new Logger(PdfGeneratorService.name);
  private browser: puppeteer.Browser | null = null;
  private template: HandlebarsTemplateDelegate | null = null;
  private cotizacionTemplate: HandlebarsTemplateDelegate | null = null;
  private guiaTemplate: HandlebarsTemplateDelegate | null = null;

  async onModuleInit() {
    // Cargar template: intentar en dist y src para soportar start y start:dev
    const candidates = [
      path.join(__dirname, 'templates', 'comprobante.hbs'), // dist/src/comprobante/templates
      path.join(
        process.cwd(),
        'src',
        'comprobante',
        'templates',
        'comprobante.hbs',
      ), // src directo
    ];

    let foundPath: string | null = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        foundPath = p;
        break;
      }
    }

    if (!foundPath) {
      this.logger.error(
        `❌ Template no encontrado. Buscado en: ${candidates.join(' | ')}`,
      );
      throw new Error('Template de comprobante no encontrado');
    }

    // Registrar helpers de Handlebars
    Handlebars.registerHelper('includes', (str: string, substr: string) => {
      return str && substr && str.toUpperCase().includes(substr.toUpperCase());
    });
    Handlebars.registerHelper('inc', (value: number) => value + 1);
    // Compara dos valores (normalizando mayúsculas/espacios) — usado p.ej. para
    // no duplicar la razón social cuando es igual al nombre comercial.
    Handlebars.registerHelper('eq', (a: any, b: any) => {
      const norm = (v: any) => (v ?? '').toString().trim().toUpperCase();
      return norm(a) === norm(b);
    });
    // OR lógico — usado en cotización para mostrar el cuadro de datos si al
    // menos una de sus columnas (cliente / cotización) está visible.
    Handlebars.registerHelper('or', (...args: any[]) => {
      // El último argumento es el "options" de Handlebars; se ignora.
      return args.slice(0, -1).some((v) => !!v);
    });

    const templateSource = fs.readFileSync(foundPath, 'utf-8');
    this.template = Handlebars.compile(templateSource);
    this.logger.log(`✅ Template de comprobante cargado: ${foundPath}`);

    // Cargar template de cotización
    const cotizacionCandidates = [
      path.join(__dirname, 'templates', 'cotizacion.hbs'),
      path.join(
        process.cwd(),
        'src',
        'comprobante',
        'templates',
        'cotizacion.hbs',
      ),
    ];

    let cotizacionPath: string | null = null;
    for (const p of cotizacionCandidates) {
      if (fs.existsSync(p)) {
        cotizacionPath = p;
        break;
      }
    }

    if (cotizacionPath) {
      const cotizacionSource = fs.readFileSync(cotizacionPath, 'utf-8');
      this.cotizacionTemplate = Handlebars.compile(cotizacionSource);
      this.logger.log(`✅ Template de cotización cargado: ${cotizacionPath}`);
    } else {
      this.logger.warn(
        '⚠️ Template de cotización no encontrado, usando template genérico',
      );
    }

    // Cargar template de guía de remisión
    const guiaCandidates = [
      path.join(__dirname, 'templates', 'guia-remision.hbs'),
      path.join(
        process.cwd(),
        'src',
        'comprobante',
        'templates',
        'guia-remision.hbs',
      ),
    ];

    let guiaPath: string | null = null;
    for (const p of guiaCandidates) {
      if (fs.existsSync(p)) {
        guiaPath = p;
        break;
      }
    }

    if (guiaPath) {
      const guiaSource = fs.readFileSync(guiaPath, 'utf-8');
      this.guiaTemplate = Handlebars.compile(guiaSource);
      this.logger.log(`✅ Template de guía remisión cargado: ${guiaPath}`);
    } else {
      this.logger.warn('⚠️ Template de guía remisión no encontrado');
    }
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close().catch((error) => {
        this.logger.warn(
          `No se pudo cerrar Puppeteer al destruir módulo: ${error.message}`,
        );
      });
    }
  }

  private async getBrowser(): Promise<puppeteer.Browser> {
    if (this.browser && !this.browser.isConnected()) {
      this.logger.warn(
        '⚠️ Puppeteer estaba desconectado; se reiniciará el browser',
      );
      this.browser = null;
    }

    if (!this.browser) {
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      const userDataDir = path.join('/tmp', 'falconext-puppeteer');
      const launchOptions: puppeteer.LaunchOptions = {
        headless: true,
        executablePath: executablePath || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-crashpad',
          '--disable-breakpad',
          '--disable-crash-reporter',
          '--disable-extensions',
          '--disable-features=VizDisplayCompositor',
          '--no-zygote',
          `--user-data-dir=${userDataDir}`,
          `--crash-dumps-dir=${path.join('/tmp', 'falconext-puppeteer-crash')}`,
        ],
      };
      try {
        this.browser = await puppeteer.launch(launchOptions);
      } catch (err: any) {
        // Un Chrome huérfano (p. ej. backend cerrado abruptamente) deja un
        // SingletonLock que bloquea el nuevo browser. Lo limpiamos y reintentamos.
        const msg = String(err?.message || err || '');
        if (/already running|SingletonLock/i.test(msg)) {
          this.logger.warn(
            '⚠️ Lock de Puppeteer huérfano detectado; limpiando y reintentando',
          );
          this.limpiarLockPuppeteer(userDataDir);
          this.browser = await puppeteer.launch(launchOptions);
        } else {
          throw err;
        }
      }
      this.logger.log(
        `✅ Puppeteer browser inicializado (chrome: ${executablePath || 'auto'})`,
      );
    }
    return this.browser;
  }

  /** Elimina los locks de sesión (Singleton*) que un Chrome huérfano deja atrás. */
  private limpiarLockPuppeteer(userDataDir: string) {
    for (const nombre of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try {
        fs.rmSync(path.join(userDataDir, nombre), { force: true });
      } catch {
        // ignorar: si no existe o no se puede borrar, el reintento lo reportará
      }
    }
  }

  private isRecoverableBrowserError(error: any): boolean {
    const message = String(error?.message || error || '').toLowerCase();
    const name = String(error?.name || '').toLowerCase();
    return (
      name.includes('connectionclosed') ||
      message.includes('connection closed') ||
      message.includes('target closed') ||
      message.includes('session closed') ||
      message.includes('protocol error') ||
      message.includes('browser has disconnected')
    );
  }

  private async resetBrowser(reason: string) {
    if (!this.browser) return;
    this.logger.warn(`♻️ Reiniciando Puppeteer: ${reason}`);
    const browser = this.browser;
    this.browser = null;
    await browser.close().catch((error) => {
      this.logger.warn(`No se pudo cerrar browser dañado: ${error.message}`);
    });
  }

  private async renderPdfBuffer(
    html: string,
    options: Parameters<puppeteer.Page['pdf']>[0],
    successMessage: string,
  ): Promise<Buffer> {
    let lastError: any;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let page: puppeteer.Page | null = null;
      try {
        const browser = await this.getBrowser();
        page = await browser.newPage();

        page.setDefaultTimeout(15_000);
        page.setDefaultNavigationTimeout(15_000);

        await page.setContent(html, {
          waitUntil: 'domcontentloaded',
          timeout: 15_000,
        });

        await page
          .waitForNetworkIdle({ idleTime: 500, timeout: 5_000 })
          .catch(() => {
            this.logger.warn(
              '⚠️ PDF generado sin esperar recursos externos lentos',
            );
          });

        const pdfBuffer = await page.pdf(options);
        this.logger.log(successMessage);
        return Buffer.from(pdfBuffer);
      } catch (error: any) {
        lastError = error;
        if (this.isRecoverableBrowserError(error) && attempt < 2) {
          await this.resetBrowser(
            error.message || 'browser cerrado durante generación PDF',
          );
          this.logger.warn(
            '🔁 Reintentando generación PDF con un browser nuevo',
          );
          continue;
        }
        throw error;
      } finally {
        await page?.close().catch((error) => {
          this.logger.warn(
            `No se pudo cerrar la página de Puppeteer: ${error.message}`,
          );
        });
      }
    }

    throw lastError;
  }

  /**
   * Genera PDF de comprobante personalizado del sistema
   */
  async generarPDFComprobante(data: {
    // Empresa
    nombreComercial: string;
    razonSocial: string;
    ruc: string;
    direccion: string;
    rubro?: string;
    celular?: string;
    email?: string;
    logo?: string; // base64 o data URL

    // Comprobante
    tipoDocumento: string; // "FACTURA", "BOLETA", etc.
    serie: string;
    correlativo: string;
    fecha: string;
    hora: string;

    // Cliente
    clienteNombre: string;
    clienteTipoDoc: string; // "RUC", "DNI"
    clienteNumDoc: string;
    clienteDireccion?: string;

    // Productos
    productos: Array<{
      cantidad: number;
      unidadMedida: string;
      descripcion: string;
      precioUnitario: string;
      total: string;
      lotes?: Array<{ lote: string; fechaVencimiento: string }>;
    }>;

    mostrarLotes?: boolean;

    // Totales
    mtoOperGravadas: string;
    mtoIGV: string;
    mtoOperExoneradas?: string;
    mtoOperInafectas?: string;
    mtoImpVenta: string;
    descuento?: string;
    totalEnLetras?: string;

    // Otros
    formaPago: string;
    medioPago?: string;
    vuelto?: string;
    pagado?: string;
    vendedor?: string;
    observaciones?: string;
    qrCode?: string; // base64 o data URL

    // Detracción
    tipoDetraccion?: string; // e.g. "037 (12%)"
    montoDetraccion?: string; // e.g. "144.00"
    cuentaBancoNacion?: string;
    medioPagoDetraccion?: string; // e.g. "001 (Depósito en cuenta)"

    // Pagos digitales
    yapeNumero?: string;
    yapeQrUrl?: string;
    plinNumero?: string;
    plinQrUrl?: string;
  }): Promise<Buffer> {
    try {
      if (!this.template) {
        throw new Error('Template no cargado');
      }

      // Generar HTML desde template
      const html = this.template(data);

      return this.renderPdfBuffer(
        html,
        {
          format: 'A4',
          printBackground: true,
          margin: {
            top: '10mm',
            right: '10mm',
            bottom: '10mm',
            left: '10mm',
          },
        },
        '✅ PDF generado exitosamente',
      );
    } catch (error) {
      this.logger.error(
        `❌ Error generando PDF: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Genera PDF en formato ticket (80mm)
   */
  async generarPDFTicket(data: any): Promise<Buffer> {
    try {
      if (!this.template) {
        throw new Error('Template no cargado');
      }

      const html = this.template(data);

      return this.renderPdfBuffer(
        html,
        {
          width: '80mm',
          printBackground: true,
          margin: {
            top: '5mm',
            right: '5mm',
            bottom: '5mm',
            left: '5mm',
          },
        },
        '✅ PDF ticket generado exitosamente',
      );
    } catch (error) {
      this.logger.error(
        `❌ Error generando PDF ticket: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Genera PDF específico para cotizaciones con diseño personalizado
   */
  async generarPDFCotizacion(data: {
    // Empresa
    nombreComercial: string;
    razonSocial: string;
    ruc: string;
    direccion: string;
    rubro?: string;
    celular?: string;
    email?: string;
    // Toggles configurables por empresa (por defecto true = mostrar)
    mostrarEmail?: boolean;
    mostrarCuentas?: boolean;
    mostrarRazonSocial?: boolean;
    logo?: string;

    // Documento
    serie: string;
    correlativo: string;
    fecha: string;
    hora: string;

    // Cliente
    clienteNombre: string;
    clienteNumDoc: string;
    clienteDireccion?: string;
    clienteEmail?: string;
    clienteTelefono?: string;

    // Productos
    productos: Array<{
      cantidad: number;
      unidadMedida: string;
      descripcion: string;
      precioUnitario: string;
      total: string;
      imagenUrl?: string;
    }>;

    includeProductImages?: boolean;

    // Totales
    mtoOperGravadas: string;
    mtoIGV: string;
    subTotal: string;
    mtoOperExoneradas?: string;
    mtoOperInafectas?: string;
    mtoImpVenta: string;
    descuento?: string;
    totalEnLetras?: string;

    // Otros
    formaPago: string;
    validez?: string;
    observaciones?: string;
    cotizTerminos?: string;

    // Datos bancarios
    bancoNombre?: string;
    numeroCuenta?: string;
    cci?: string;
    monedaCuenta?: string;

    // Usuario y marca
    usuario?: string;
    sistemaUrl?: string;
    sistemaNombre?: string;
  }): Promise<Buffer> {
    try {
      // Usar template de cotización si existe, sino el genérico
      const template = this.cotizacionTemplate || this.template;
      if (!template) {
        throw new Error('Template no cargado');
      }

      // Generar HTML desde template
      const html = template(data);

      return this.renderPdfBuffer(
        html,
        {
          format: 'A4',
          printBackground: true,
          margin: {
            top: '10mm',
            right: '10mm',
            bottom: '10mm',
            left: '10mm',
          },
        },
        '✅ PDF de cotización generado exitosamente',
      );
    } catch (error) {
      this.logger.error(
        `❌ Error generando PDF de cotización: ${error.message}`,
        error.stack,
      );
      this.logger.warn('⚠️ Usando fallback PDF simple para cotización');
      return this.generarPDFCotizacionSimple(data);
    }
  }
  async generarPDFGuiaRemision(data: any): Promise<Buffer> {
    try {
      if (!this.guiaTemplate) {
        throw new Error('Template de guía de remisión no cargado');
      }

      const html = this.guiaTemplate(data);

      return this.renderPdfBuffer(
        html,
        {
          format: 'A4',
          printBackground: true,
          margin: {
            top: '10mm',
            right: '10mm',
            bottom: '10mm',
            left: '10mm',
          },
        },
        '✅ PDF de guía de remisión generado exitosamente',
      );
    } catch (error) {
      this.logger.error(
        `❌ Error generando PDF de guía: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private escapePdfText(value: unknown): string {
    return String(value ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\r?\n/g, ' ');
  }

  private normalizePdfText(value: unknown): string {
    return String(value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private wrapPdfText(value: unknown, maxLength = 88): string[] {
    const words = this.normalizePdfText(value).split(' ').filter(Boolean);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxLength && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }

    if (current) lines.push(current);
    return lines.length ? lines : [''];
  }

  private generarPdfTextoSimple(lines: string[]): Buffer {
    const pageLines: string[][] = [];
    const maxLinesPerPage = 48;

    for (let i = 0; i < lines.length; i += maxLinesPerPage) {
      pageLines.push(lines.slice(i, i + maxLinesPerPage));
    }

    const pageRefs = pageLines.map((_, index) => 4 + index * 2);
    const kids = pageRefs.map((ref) => `${ref} 0 R`).join(' ');
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageLines.length} >>\nendobj\n`,
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ];

    pageLines.forEach((page, index) => {
      const pageRef = 4 + index * 2;
      const contentRef = pageRef + 1;
      const commands = ['BT'];

      page.forEach((line, lineIndex) => {
        const isTitle = index === 0 && lineIndex === 0;
        const fontSize = isTitle ? 16 : 10;
        const y = isTitle ? 790 : 762 - (lineIndex - 1) * 14;
        commands.push(`/F1 ${fontSize} Tf`);
        commands.push(`1 0 0 1 46 ${y} Tm`);
        commands.push(`(${this.escapePdfText(line)}) Tj`);
      });

      commands.push('ET');
      const content = commands.join('\n');

      objects.push(
        `${pageRef} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentRef} 0 R >>\nendobj\n`,
      );
      objects.push(
        `${contentRef} 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
      );
    });

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += object;
    }

    const xrefOffset = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i += 1) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, 'utf8');
  }

  private generarPDFCotizacionSimple(data: any): Buffer {
    const numero =
      `${data.serie || ''}-${data.correlativo || ''}`.replace(/^-|-$/g, '') ||
      '-';
    const lines = [
      `COTIZACION ${numero}`,
      this.normalizePdfText(
        data.nombreComercial || data.razonSocial || 'Empresa',
      ),
      `RUC: ${this.normalizePdfText(data.ruc || '-')}`,
      `Direccion: ${this.normalizePdfText(data.direccion || '-')}`,
      `Contacto: ${this.normalizePdfText([data.celular, data.email].filter(Boolean).join(' / ') || '-')}`,
      '',
      `Fecha: ${this.normalizePdfText(data.fecha || '-')}  Hora: ${this.normalizePdfText(data.hora || '-')}`,
      `Cliente: ${this.normalizePdfText(data.clienteNombre || '-')}`,
      `Documento: ${this.normalizePdfText(data.clienteNumDoc || '-')}`,
      `Direccion cliente: ${this.normalizePdfText(data.clienteDireccion || '-')}`,
      '',
      'DETALLE DE PRODUCTOS',
    ];

    (data.productos || []).forEach((producto: any, index: number) => {
      const description = this.wrapPdfText(producto.descripcion || '-', 72);
      lines.push(
        `${index + 1}. ${this.normalizePdfText(producto.cantidad || '1')} ${this.normalizePdfText(producto.unidadMedida || 'UND')} - ${description[0]}`,
      );
      description.slice(1).forEach((line) => lines.push(`   ${line}`));
      lines.push(
        `   Precio unit.: S/ ${this.normalizePdfText(producto.precioUnitario || '0.00')}    Total: S/ ${this.normalizePdfText(producto.total || '0.00')}`,
      );
    });

    lines.push(
      '',
      `Subtotal: S/ ${this.normalizePdfText(data.subTotal || data.mtoOperGravadas || '0.00')}`,
      `IGV: S/ ${this.normalizePdfText(data.mtoIGV || '0.00')}`,
      `Total: S/ ${this.normalizePdfText(data.mtoImpVenta || '0.00')}`,
      `Son: ${this.normalizePdfText(data.totalEnLetras || '-')}`,
      '',
      `Forma de pago: ${this.normalizePdfText(data.formaPago || '-')}`,
      `Validez: ${this.normalizePdfText(data.validez || '-')}`,
      `Observaciones: ${this.normalizePdfText(data.observaciones || '-')}`,
    );

    if (data.bancoNombre || data.numeroCuenta || data.cci) {
      lines.push(
        '',
        'DATOS BANCARIOS',
        `Banco: ${this.normalizePdfText(data.bancoNombre || '-')}`,
        `Cuenta: ${this.normalizePdfText(data.numeroCuenta || '-')}`,
        `CCI: ${this.normalizePdfText(data.cci || '-')}`,
        `Moneda: ${this.normalizePdfText(data.monedaCuenta || '-')}`,
      );
    }

    lines.push(
      '',
      `Generado por ${this.normalizePdfText(data.sistemaNombre || 'Falconext')}`,
    );
    return this.generarPdfTextoSimple(lines);
  }

  private generarPDFConstanciaGarantiaSimple(data: any): Buffer {
    const formatDate = (value?: Date | string | null) => {
      if (!value) return 'Sin fecha';
      return new Intl.DateTimeFormat('es-PE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(value));
    };

    const comprobanteNumero = data.comprobante?.numero || 'Sin venta asociada';
    const lines = [
      'CONSTANCIA DE GARANTIA',
      data.empresa?.razonSocial || '',
      `RUC: ${data.empresa?.ruc || '-'}`,
      '',
      `Serie: ${data.serie?.numeroSerie || '-'}`,
      `Estado: ${data.serie?.estado || '-'}`,
      `Valida hasta: ${formatDate(data.serie?.garantiaHasta)}`,
      '',
      `Producto: ${data.producto?.descripcion || '-'}`,
      `Codigo: ${data.producto?.codigo || '-'}`,
      `Marca / Modelo: ${data.producto?.marca || '-'} ${data.producto?.modelo || ''}`,
      `Part number: ${data.producto?.partNumber || '-'}`,
      `Sede: ${data.serie?.sede || 'Sede principal'}`,
      '',
      `Cliente: ${data.cliente?.nombre || 'Sin cliente asociado'}`,
      `Documento: ${data.cliente?.nroDoc || '-'}`,
      `Comprobante: ${comprobanteNumero}`,
      `Fecha venta: ${formatDate(data.comprobante?.fechaEmision)}`,
      '',
      `Meses cubiertos: ${data.serie?.garantiaMeses ?? 'Sin garantia'}`,
      `Compra origen: ${data.compra?.numero || 'Sin compra asociada'}`,
      `Observacion: ${data.serie?.observacion || 'Sin observaciones'}`,
      '',
      'La garantia aplica segun las condiciones comerciales del negocio.',
      'No cubre danos por mal uso, manipulacion externa, golpes, humedad,',
      'sobrecarga electrica o instalacion inadecuada.',
      '',
      'Area tecnica / Garantias',
    ];

    const content = [
      'BT',
      '/F1 20 Tf',
      '50 790 Td',
      `(${this.escapePdfText(lines[0])}) Tj`,
      '/F1 11 Tf',
      ...lines
        .slice(1)
        .flatMap((line) => ['0 -22 Td', `(${this.escapePdfText(line)}) Tj`]),
      'ET',
    ].join('\n');

    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      `5 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += object;
    }
    const xrefOffset = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i += 1) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'utf8');
  }

  async generarPDFConstanciaGarantia(data: any): Promise<Buffer> {
    this.logger.log(
      '🎫 Iniciando generación de constancia de garantía con Puppeteer...',
    );
    try {
      const formatDate = (value?: Date | string | null) => {
        if (!value) return 'Sin fecha';
        return new Intl.DateTimeFormat('es-PE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(new Date(value));
      };

      const fechaLarga = new Intl.DateTimeFormat('es-PE', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
        .format(new Date())
        .replace(' de ', ' de ')
        .replace(/(\d{4})$/, 'del $1');

      const fechaEmision = new Intl.DateTimeFormat('es-PE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());

      const certNumber = `${String(data.serie?.id ?? 1).padStart(4, '0')}-${new Date().getFullYear()}`;
      const iniciales = (data.empresa?.razonSocial || 'FX')
        .split(' ')
        .slice(0, 2)
        .map((w: string) => w[0])
        .join('')
        .toUpperCase();
      const meses = Number(data.serie?.garantiaMeses ?? 0);
      const garantiaMesesLabel = meses === 1 ? 'MES' : 'MESES';

      const template = Handlebars.compile(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;color:#111827;background:#fff;font-size:13px}
  .page{width:794px;min-height:1122px;padding:50px 65px;position:relative}
  /* ── MEMBRETE ── */
  .letterhead{display:flex;align-items:flex-start;gap:20px;padding-bottom:18px;border-bottom:3px double #1e3a8a;margin-bottom:26px}
  .logo-img{width:88px;height:88px;object-fit:contain;flex-shrink:0}
  .logo-fallback{width:88px;height:88px;background:#1e3a8a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:900;border-radius:8px;flex-shrink:0;letter-spacing:-1px}
  .co-name{font-size:16px;font-weight:900;text-transform:uppercase;color:#1e3a8a;letter-spacing:.02em}
  .co-detail{font-size:12px;color:#374151;margin-top:4px;line-height:1.5}
  .cert-badge{margin-left:auto;text-align:right;flex-shrink:0}
  .cert-badge span{display:inline-block;border:1px solid #d1d5db;padding:5px 12px;border-radius:5px;font-size:11px;font-weight:700;color:#4b5563;white-space:nowrap}
  /* ── TÍTULO ── */
  .title-block{text-align:center;margin-bottom:26px}
  .cert-ref{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.15em;color:#6b7280;text-decoration:underline;margin-bottom:8px}
  .cert-title{font-size:26px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#111827}
  /* ── CUERPO ── */
  .date-line{text-align:right;margin-bottom:20px;font-size:13px}
  .section-block{margin-bottom:14px}
  .section-label{font-weight:700;font-size:13px}
  .section-value{font-size:13px;margin-top:2px}
  .body-p{font-size:13px;line-height:1.75;text-align:justify;margin-bottom:14px}
  /* ── TABLA ── */
  table{width:100%;border-collapse:collapse;margin:18px 0 20px;font-size:12px}
  thead tr{background:#1e3a8a;color:#fff}
  thead th{padding:8px 10px;text-align:left;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
  tbody tr{border-bottom:1px solid #e5e7eb}
  tbody tr:nth-child(even){background:#f9fafb}
  td{padding:8px 10px;vertical-align:top}
  .td-serie{font-family:Consolas,monospace;font-weight:700;color:#1e3a8a;font-size:13px}
  /* ── CONDICIONES ── */
  .terms{background:#f3f4f6;border-left:4px solid #1e3a8a;padding:11px 15px;font-size:11.5px;color:#4b5563;line-height:1.65;border-radius:0 5px 5px 0;margin-bottom:32px}
  /* ── FIRMA ── */
  .sig-row{display:flex;justify-content:space-between;align-items:flex-end;margin-top:20px}
  .sig-meta{font-size:11px;color:#6b7280;line-height:1.7}
  .sig-block{text-align:center;width:210px}
  .sig-line{border-top:1px solid #374151;padding-top:8px;font-size:11px;font-weight:700;text-transform:uppercase}
  .sig-sub{font-size:10px;color:#6b7280;margin-top:3px}
  /* ── PIE ── */
  .doc-footer{position:absolute;bottom:30px;left:65px;right:65px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af}
</style>
</head>
<body>
<div class="page">

  {{!-- MEMBRETE --}}
  <div class="letterhead">
    {{#if empresa.logo}}
      <img class="logo-img" src="{{empresa.logo}}"/>
    {{else}}
      <div class="logo-fallback">{{empresa.iniciales}}</div>
    {{/if}}
    <div style="flex:1">
      <div class="co-name">{{empresa.razonSocial}}</div>
      <div class="co-detail">RUC: {{empresa.ruc}}</div>
      {{#if empresa.direccion}}<div class="co-detail">{{empresa.direccion}}</div>{{/if}}
      {{#if empresa.contacto}}<div class="co-detail">{{empresa.contacto}}</div>{{/if}}
    </div>
    <div class="cert-badge"><span>N° {{certNumber}}</span></div>
  </div>

  {{!-- TÍTULO --}}
  <div class="title-block">
    <div class="cert-ref">CERTIFICADO DE GARANTIA N° {{certNumber}} {{empresa.razonSocial}}</div>
    <div class="cert-title">Certificado de Garantía</div>
  </div>

  {{!-- FECHA --}}
  <div class="date-line">Lima, {{fechaLarga}}</div>

  {{!-- DESTINATARIO --}}
  {{#if cliente.nombre}}
  <div class="section-block">
    <div class="section-label">Señores:</div>
    <div class="section-value">{{cliente.nombre}}{{#if cliente.nroDoc}} &nbsp;·&nbsp; {{cliente.nroDoc}}{{/if}}</div>
  </div>
  {{/if}}

  {{!-- REFERENCIA --}}
  {{#if comprobante.numero}}
  <div class="section-block" style="margin-bottom:20px">
    <div class="section-label">Referencia:</div>
    <div class="section-label" style="margin-top:2px">Comprobante N° {{comprobante.numero}}</div>
  </div>
  {{/if}}

  {{!-- CUERPO --}}
  <p class="body-p">
    &nbsp;&nbsp;La empresa <strong>{{empresa.razonSocial}}</strong> con RUC: <strong>{{empresa.ruc}}</strong>, nos complace otorgarle la presente garantía por defecto de diseño y/o fabricación, averías o fallas de funcionamiento ajenas al uso normal o habitual de los equipos, asimismo aquellas fallas de fábrica que no se hayan detectado al momento en que se le otorgó la conformidad.
  </p>
  <p class="body-p">
    <strong>{{empresa.razonSocial}}</strong>, garantiza el equipo por defecto de fabricación por un período de <strong>{{serie.garantiaMeses}} ({{serie.garantiaMesesNum}}) {{garantiaMesesLabel}}</strong>. El equipo garantizado es el siguiente:
  </p>

  {{!-- TABLA --}}
  <table>
    <thead>
      <tr>
        <th>N° de Serie</th>
        <th>Descripción del producto</th>
        <th>Marca / Modelo</th>
        <th>Garantía hasta</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="td-serie">{{serie.numeroSerie}}</td>
        <td>{{producto.descripcion}}{{#if producto.partNumber}}<br/><span style="font-size:11px;color:#6b7280">PN: {{producto.partNumber}}</span>{{/if}}</td>
        <td>{{producto.marca}}{{#if producto.modelo}} / {{producto.modelo}}{{/if}}</td>
        <td>{{garantiaHasta}}</td>
      </tr>
    </tbody>
  </table>

  {{!-- CONDICIONES --}}
  <div class="terms">
    <strong>Condiciones de garantía:</strong> La presente garantía aplica según las condiciones comerciales de {{empresa.razonSocial}} y podrá requerir diagnóstico técnico previo. No cubre daños por mal uso, manipulación externa, golpes, humedad, sobrecarga eléctrica o instalación inadecuada.{{#if serie.observacion}} <strong>Observación:</strong> {{serie.observacion}}.{{/if}}
  </div>

  {{!-- FIRMA --}}
  <div class="sig-row">
    <div class="sig-meta">
      Emitido: {{fechaEmision}}<br/>
      {{#if serie.sede}}Sede: {{serie.sede}}{{/if}}
    </div>
    <div class="sig-block">
      <div style="height:42px"></div>
      <div class="sig-line">{{empresa.nombreComercial}}</div>
      <div class="sig-sub">Área técnica / Garantías</div>
    </div>
  </div>

  {{!-- PIE --}}
  <div class="doc-footer">
    <span>{{empresa.razonSocial}} — RUC {{empresa.ruc}}</span>
    <span>Documento generado el {{fechaEmision}}</span>
  </div>

</div>
</body>
</html>`);

      const html = template({
        certNumber,
        fechaLarga,
        fechaEmision,
        garantiaHasta: formatDate(data.serie.garantiaHasta),
        garantiaMesesLabel,
        empresa: {
          ...data.empresa,
          iniciales,
          nombreComercial:
            data.empresa.nombreComercial || data.empresa.razonSocial,
          direccion: data.empresa.direccion || '',
          contacto: [data.empresa.telefono].filter(Boolean).join(' · '),
        },
        producto: {
          ...data.producto,
          marca: data.producto.marca || '',
          modelo: data.producto.modelo || '',
          partNumber: data.producto.partNumber || '',
        },
        serie: {
          ...data.serie,
          garantiaMeses: meses > 0 ? `${meses}` : 'Sin garantía',
          garantiaMesesNum: meses > 0 ? String(meses) : '',
          observacion: data.serie.observacion || '',
          sede: data.serie.sede || '',
        },
        cliente: {
          nombre: data.cliente?.nombre || '',
          nroDoc: data.cliente?.nroDoc || '',
        },
        comprobante: {
          numero: data.comprobante?.numero || '',
          fecha: formatDate(data.comprobante?.fechaEmision),
        },
        compra: {
          numero: data.compra?.numero || '',
        },
      });

      return this.renderPdfBuffer(
        html,
        {
          format: 'A4',
          printBackground: true,
          margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
        },
        '✅ PDF constancia de garantía generado',
      );
    } catch (error) {
      this.logger.error(
        `❌ Error generando constancia de garantía: ${error.message}`,
        error.stack,
      );
      this.logger.warn(
        '⚠️ Usando fallback PDF simple para constancia de garantía',
      );
      return this.generarPDFConstanciaGarantiaSimple(data);
    }
  }
}
