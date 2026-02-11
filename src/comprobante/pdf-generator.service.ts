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
      path.join(process.cwd(), 'src', 'comprobante', 'templates', 'comprobante.hbs'), // src directo
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

    const templateSource = fs.readFileSync(foundPath, 'utf-8');
    this.template = Handlebars.compile(templateSource);
    this.logger.log(`✅ Template de comprobante cargado: ${foundPath}`);

    // Cargar template de cotización
    const cotizacionCandidates = [
      path.join(__dirname, 'templates', 'cotizacion.hbs'),
      path.join(process.cwd(), 'src', 'comprobante', 'templates', 'cotizacion.hbs'),
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
      this.logger.warn('⚠️ Template de cotización no encontrado, usando template genérico');
    }

    // Cargar template de guía de remisión
    const guiaCandidates = [
      path.join(__dirname, 'templates', 'guia-remision.hbs'),
      path.join(process.cwd(), 'src', 'comprobante', 'templates', 'guia-remision.hbs'),
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
      await this.browser.close();
    }
  }

  private async getBrowser(): Promise<puppeteer.Browser> {
    if (!this.browser) {
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      this.browser = await puppeteer.launch({
        headless: true,
        executablePath: executablePath || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-crash-reporter',
          '--disable-extensions',
          '--disable-features=VizDisplayCompositor',
          '--no-zygote',
          '--single-process',
        ],
      });
      this.logger.log(`✅ Puppeteer browser inicializado (chrome: ${executablePath || 'auto'})`);
    }
    return this.browser;
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
    mtoOperInafectas?: string;
    mtoImpVenta: string;
    descuento?: string;
    totalEnLetras?: string;

    // Otros
    formaPago: string;
    medioPago?: string;
    observaciones?: string;
    qrCode?: string; // base64 o data URL

    // Detracción
    tipoDetraccion?: string; // e.g. "037 (12%)"
    montoDetraccion?: string; // e.g. "144.00"
    cuentaBancoNacion?: string;
    medioPagoDetraccion?: string; // e.g. "001 (Depósito en cuenta)"
  }): Promise<Buffer> {
    try {
      if (!this.template) {
        throw new Error('Template no cargado');
      }

      // Generar HTML desde template
      const html = this.template(data);

      // Generar PDF con Puppeteer
      const browser = await this.getBrowser();
      const page = await browser.newPage();

      await page.setContent(html, {
        waitUntil: 'networkidle0',
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm',
        },
      });

      await page.close();

      this.logger.log('✅ PDF generado exitosamente');
      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error(`❌ Error generando PDF: ${error.message}`, error.stack);
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

      const browser = await this.getBrowser();
      const page = await browser.newPage();

      await page.setContent(html, {
        waitUntil: 'networkidle0',
      });

      const pdfBuffer = await page.pdf({
        width: '80mm',
        printBackground: true,
        margin: {
          top: '5mm',
          right: '5mm',
          bottom: '5mm',
          left: '5mm',
        },
      });

      await page.close();

      this.logger.log('✅ PDF ticket generado exitosamente');
      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error(`❌ Error generando PDF ticket: ${error.message}`, error.stack);
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
    }>;

    // Totales
    mtoOperGravadas: string;
    mtoIGV: string;
    subTotal: string;
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

    // Usuario
    usuario?: string;
  }): Promise<Buffer> {
    try {
      // Usar template de cotización si existe, sino el genérico
      const template = this.cotizacionTemplate || this.template;
      if (!template) {
        throw new Error('Template no cargado');
      }

      // Generar HTML desde template
      const html = template(data);

      // Generar PDF con Puppeteer
      const browser = await this.getBrowser();
      const page = await browser.newPage();

      await page.setContent(html, {
        waitUntil: 'networkidle0',
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm',
        },
      });

      await page.close();

      this.logger.log('✅ PDF de cotización generado exitosamente');
      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error(`❌ Error generando PDF de cotización: ${error.message}`, error.stack);
      throw error;
    }
  }
  async generarPDFGuiaRemision(data: any): Promise<Buffer> {
    try {
      if (!this.guiaTemplate) {
        throw new Error('Template de guía de remisión no cargado');
      }

      const html = this.guiaTemplate(data);

      const browser = await this.getBrowser();
      const page = await browser.newPage();

      await page.setContent(html, {
        waitUntil: 'networkidle0',
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm',
        },
      });

      await page.close();

      this.logger.log('✅ PDF de guía de remisión generado exitosamente');
      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error(`❌ Error generando PDF de guía: ${error.message}`, error.stack);
      throw error;
    }
  }
}
