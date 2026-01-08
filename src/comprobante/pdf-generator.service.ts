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
          '--user-data-dir=/tmp/chrome-data',
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
}
