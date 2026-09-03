import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import sharp from 'sharp';
import FormData from 'form-data';

interface EnviarComprobanteParams {
  comprobanteId: number;
  empresaId: number;
  usuarioId: number;
  numeroDestino: string;
  pdfUrl: string;
  xmlUrl?: string;
  incluyeXML: boolean;
  empresaNombre: string;
  tipoDoc: string;
  serie: string;
  correlativo: number;
  monto: number;
}

interface EnviarGuiaParams {
  guiaRemisionId: number;
  empresaId: number;
  usuarioId: number;
  numeroDestino: string;
  pdfUrl: string;
  empresaNombre: string;
  serie: string;
  correlativo: number;
  destinatario: string;
}

interface WhatsAppCredentials {
  token: string;
  phoneId: string;
  source: 'PLATFORM' | 'EMPRESA';
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly apiUrl = 'https://graph.facebook.com/v21.0';

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const { token, phoneId } = this.getCredentials();

    if (!token || !phoneId) {
      this.logger.warn(
        '⚠️  Credenciales de WhatsApp Cloud API no configuradas.',
      );
    } else {
      this.logger.log('✅ WhatsApp Cloud API inicializado correctamente');
    }
  }

  private getCredentials(): { token: string; phoneId: string } {
    const token =
      this.configService.get<string>('WHATSAPP_TOKEN') ||
      this.configService.get<string>('META_WHATSAPP_TOKEN') ||
      '';
    const phoneId =
      this.configService.get<string>('WHATSAPP_PHONE_ID') ||
      this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID') ||
      this.configService.get<string>('META_WHATSAPP_PHONE_ID') ||
      '';

    return { token, phoneId };
  }

  private async getCredentialsForEmpresa(
    empresaId: number,
  ): Promise<WhatsAppCredentials> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        whatsappProvider: true,
        whatsappApiToken: true,
        whatsappPhoneNumberId: true,
        whatsappActivo: true,
      },
    });

    if (!empresa?.whatsappActivo || empresa?.whatsappProvider === 'DISABLED') {
      throw new BadRequestException(
        'WhatsApp está deshabilitado para esta empresa.',
      );
    }

    if (empresa.whatsappProvider === 'EMPRESA') {
      if (!empresa.whatsappApiToken || !empresa.whatsappPhoneNumberId) {
        throw new BadRequestException(
          'WhatsApp propio no configurado. Agrega token y phone number ID de Meta para esta empresa.',
        );
      }

      return {
        token: empresa.whatsappApiToken,
        phoneId: empresa.whatsappPhoneNumberId,
        source: 'EMPRESA',
      };
    }

    const platform = this.getCredentials();
    if (!platform.token || !platform.phoneId) {
      throw new BadRequestException(
        'WhatsApp de plataforma no está configurado.',
      );
    }

    return { ...platform, source: 'PLATFORM' };
  }

  /**
   * Descarga un archivo (media) de WhatsApp Cloud API por su `mediaId`, usando
   * el token de la empresa. Flujo Meta: GET /{mediaId} → { url, mime_type };
   * luego GET esa url (autenticada) → binario.
   */
  async descargarMedia(
    mediaId: string,
    empresaId: number,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const { token } = await this.getCredentialsForEmpresa(empresaId);
    const meta = await axios.get(`${this.apiUrl}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const url: string | undefined = meta.data?.url;
    const mimeType: string = meta.data?.mime_type ?? 'audio/ogg';
    if (!url) {
      throw new Error(`No se pudo resolver la URL del media ${mediaId}`);
    }
    const bin = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    });
    return { buffer: Buffer.from(bin.data), mimeType };
  }

  // ─── Embedded Signup (conectar el WhatsApp propio del empresario) ──────────
  // Reutiliza la Meta App de la plataforma (FB_APP_ID / META_APP_SECRET). El
  // empresario conecta su propio número/WABA en clics; guardamos su token en
  // Empresa (provider=EMPRESA) y auto-creamos las plantillas de despacho.

  private get fbAppId(): string {
    return this.configService.get<string>('FB_APP_ID') || '';
  }
  private get metaAppSecret(): string {
    return this.configService.get<string>('META_APP_SECRET') || '';
  }

  /** Intercambia el `code` del Embedded Signup por un token de larga duración. */
  private async exchangeCode(code: string): Promise<string> {
    try {
      const res = await axios.get(`${this.apiUrl}/oauth/access_token`, {
        params: {
          client_id: this.fbAppId,
          client_secret: this.metaAppSecret,
          code,
        },
      });
      const token = res.data?.access_token;
      if (!token) throw new Error('Meta no devolvió un access_token.');
      return token;
    } catch (e: any) {
      const gmsg =
        e?.response?.data?.error?.message || e?.message || 'error desconocido';
      this.logger.warn(`Embedded signup: intercambio de código falló: ${gmsg}`);
      throw new BadRequestException(
        `No se pudo conectar con Meta (intercambio de código): ${gmsg}`,
      );
    }
  }

  /** Descubre wabaId + phoneNumberId a partir del token (cuando no llegan del signup). */
  private async discoverPhoneFromToken(
    token: string,
  ): Promise<{ wabaId?: string; phoneNumberId?: string; displayNumber?: string }> {
    let debug: any;
    try {
      debug = await axios.get(`${this.apiUrl}/debug_token`, {
        params: { input_token: token, access_token: `${this.fbAppId}|${this.metaAppSecret}` },
      });
    } catch (e: any) {
      const gmsg =
        e?.response?.data?.error?.message || e?.message || 'error desconocido';
      this.logger.warn(`Embedded signup: debug_token falló: ${gmsg}`);
      throw new BadRequestException(
        `No se pudo leer el número de WhatsApp desde Meta: ${gmsg}`,
      );
    }
    const scopes: any[] = debug.data?.data?.granular_scopes || [];
    const waScope = scopes.find(
      (s) => s?.scope === 'whatsapp_business_management',
    );
    const wabaIds: string[] = waScope?.target_ids || [];
    for (const wabaId of wabaIds) {
      try {
        const phones = await axios.get(`${this.apiUrl}/${wabaId}/phone_numbers`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const first = phones.data?.data?.[0];
        if (first?.id) {
          return {
            wabaId,
            phoneNumberId: first.id,
            displayNumber: first.display_phone_number,
          };
        }
      } catch {
        /* seguir con el siguiente wabaId */
      }
    }
    return {};
  }

  /** Suscribe la Meta App al webhook de la WABA (no fatal si falla). */
  private async subscribeApp(wabaId: string, token: string): Promise<void> {
    try {
      await axios.post(
        `${this.apiUrl}/${wabaId}/subscribed_apps`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch (e: any) {
      this.logger.warn(
        `subscribed_apps falló para WABA ${wabaId}: ${e.response?.data?.error?.message || e.message}`,
      );
    }
  }

  private async fetchDisplayNumber(
    phoneNumberId: string,
    token: string,
  ): Promise<string | undefined> {
    try {
      const res = await axios.get(`${this.apiUrl}/${phoneNumberId}`, {
        params: { fields: 'display_phone_number' },
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data?.display_phone_number;
    } catch {
      return undefined;
    }
  }

  /**
   * Conecta el WhatsApp propio de una empresa vía Embedded Signup.
   * Guarda token+phoneNumberId+wabaId en Empresa (provider=EMPRESA) y crea las
   * plantillas de despacho en su WABA.
   */
  async conectarEmbeddedSignup(
    empresaId: number,
    input: { code?: string; accessToken?: string; phoneNumberId?: string; wabaId?: string },
  ): Promise<{ phoneNumberId: string; wabaId: string; numeroVisible?: string; plantillas: any }> {
    if (!this.fbAppId || !this.metaAppSecret) {
      throw new BadRequestException(
        'La Meta App no está configurada en el servidor (FB_APP_ID / META_APP_SECRET).',
      );
    }
    // 1) Token de larga duración.
    const token = input.code
      ? await this.exchangeCode(input.code)
      : input.accessToken;
    if (!token)
      throw new BadRequestException('Falta el code o accessToken de Meta.');

    // 2) Resolver wabaId + phoneNumberId (del signup o descubriéndolos).
    let { phoneNumberId, wabaId } = input;
    let numeroVisible: string | undefined;
    if (!phoneNumberId || !wabaId) {
      const disc = await this.discoverPhoneFromToken(token);
      phoneNumberId = phoneNumberId || disc.phoneNumberId;
      wabaId = wabaId || disc.wabaId;
      numeroVisible = disc.displayNumber;
    }
    if (!phoneNumberId || !wabaId) {
      throw new BadRequestException(
        'No se pudo resolver el número de WhatsApp. Reintenta la conexión.',
      );
    }

    // 3) Anti cross-tenant: el número no puede pertenecer a otra empresa.
    const enUso = await this.prisma.empresa.findFirst({
      where: { whatsappPhoneNumberId: phoneNumberId, id: { not: empresaId } },
      select: { id: true },
    });
    if (enUso)
      throw new BadRequestException(
        'Ese número de WhatsApp ya está conectado a otra cuenta.',
      );

    // 4) Suscribir la app al webhook de la WABA.
    await this.subscribeApp(wabaId, token);
    if (!numeroVisible)
      numeroVisible = await this.fetchDisplayNumber(phoneNumberId, token);

    // 5) Persistir en Empresa (provider=EMPRESA).
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        whatsappProvider: 'EMPRESA' as any,
        whatsappApiToken: token,
        whatsappPhoneNumberId: phoneNumberId,
        whatsappBusinessId: wabaId,
        whatsappActivo: true,
      },
    });

    // 6) Auto-crear plantillas de despacho en la WABA del empresario.
    const plantillas = await this.crearPlantillasDespacho(wabaId, token);

    this.logger.log(
      `Empresa ${empresaId} conectó WhatsApp propio (${numeroVisible ?? phoneNumberId}).`,
    );
    return { phoneNumberId, wabaId, numeroVisible, plantillas };
  }

  /**
   * Conexión MANUAL del WhatsApp propio (fallback mientras Meta aprueba el
   * Embedded Signup). El empresario pega su Phone Number ID + WABA ID + token
   * permanente. Validamos el token, guardamos y creamos las plantillas.
   */
  async conectarManual(
    empresaId: number,
    input: { phoneNumberId: string; wabaId: string; accessToken: string },
  ): Promise<{ numeroVisible?: string; plantillas: any }> {
    const { phoneNumberId, wabaId, accessToken } = input;
    if (!phoneNumberId || !wabaId || !accessToken) {
      throw new BadRequestException(
        'Faltan datos: Phone Number ID, WABA ID y token son obligatorios.',
      );
    }
    // Validar que el token + phoneNumberId funcionan (y de paso el número visible).
    const numeroVisible = await this.fetchDisplayNumber(phoneNumberId, accessToken);
    if (!numeroVisible) {
      throw new BadRequestException(
        'El token o el Phone Number ID no son válidos (Meta no reconoció el número).',
      );
    }
    // Anti cross-tenant.
    const enUso = await this.prisma.empresa.findFirst({
      where: { whatsappPhoneNumberId: phoneNumberId, id: { not: empresaId } },
      select: { id: true },
    });
    if (enUso)
      throw new BadRequestException(
        'Ese número de WhatsApp ya está conectado a otra cuenta.',
      );

    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        whatsappProvider: 'EMPRESA' as any,
        whatsappApiToken: accessToken,
        whatsappPhoneNumberId: phoneNumberId,
        whatsappBusinessId: wabaId,
        whatsappActivo: true,
      },
    });
    const plantillas = await this.crearPlantillasDespacho(wabaId, accessToken);
    this.logger.log(`Empresa ${empresaId} conectó WhatsApp manual (${numeroVisible}).`);
    return { numeroVisible, plantillas };
  }

  // Plantillas de despacho a crear en cada WABA (idioma es). Meta exige ejemplos.
  private readonly PLANTILLAS_DESPACHO = [
    {
      name: 'pedido_en_camino',
      // Meta rechaza textos con demasiadas variables por palabra o que terminan en
      // variable → hay que dejar suficiente texto y cerrar con palabras.
      body: 'Hola {{1}}, tu pedido {{2}} ya está en camino. Repartidor asignado: {{3}}. ¡Pronto llega!',
      example: ['Juan', 'B001-00000123', 'Pedro'],
    },
    {
      name: 'pedido_en_destino',
      body: 'Hola {{1}}, tu pedido {{2}} llegó a {{3}} y está listo para recojo. 📦',
      example: ['Juan', 'B001-00000123', 'Shalom Cusco Centro'],
    },
    {
      name: 'pedido_en_destino_cobro',
      body: 'Hola {{1}}, tu pedido {{2}} llegó a la agencia {{3}}. Para retirarlo, confirma el pago restante de S/ {{4}}. Te esperamos.',
      example: ['Juan', 'B001-00000123', 'Shalom Cusco Centro', '25.00'],
    },
    {
      name: 'pedido_entregado',
      body: 'Hola {{1}}, tu pedido {{2}} fue entregado exitosamente ✅. ¡Gracias por tu compra!',
      example: ['Juan', 'B001-00000123'],
    },
    {
      name: 'pago_confirmado',
      body: 'Hola {{1}}, tu pago fue confirmado. Ya puedes retirar tu pedido {{2}}. ¡Gracias! ✅',
      example: ['Juan', 'B001-00000123'],
    },
  ];

  /** Crea (idempotente) las plantillas de despacho en la WABA vía Message Template API. */
  async crearPlantillasDespacho(
    wabaId: string,
    token: string,
  ): Promise<{ creadas: string[]; existentes: string[]; errores: string[] }> {
    const creadas: string[] = [];
    const existentes: string[] = [];
    const errores: string[] = [];
    for (const p of this.PLANTILLAS_DESPACHO) {
      try {
        await axios.post(
          `${this.apiUrl}/${wabaId}/message_templates`,
          {
            name: p.name,
            language: 'es',
            category: 'UTILITY',
            components: [
              {
                type: 'BODY',
                text: p.body,
                example: { body_text: [p.example] },
              },
            ],
          },
          { headers: { Authorization: `Bearer ${token}` } },
        );
        creadas.push(p.name);
      } catch (e: any) {
        const err = e.response?.data?.error;
        // "Ya existe" → subcódigo 2388023/2388024, o el texto (es/en) en message /
        // error_user_title / error_user_msg.
        const txt = [err?.message, err?.error_user_title, err?.error_user_msg]
          .filter(Boolean)
          .join(' ');
        if (
          /already exists|ya existe/i.test(txt) ||
          err?.error_subcode === 2388023 ||
          err?.error_subcode === 2388024
        ) {
          existentes.push(p.name);
        } else {
          const detalle = err?.error_user_title || err?.message || e.message;
          this.logger.warn(`Plantilla ${p.name} falló: ${detalle}`);
          errores.push(`${p.name}: ${detalle}`);
        }
      }
    }
    return { creadas, existentes, errores };
  }

  /**
   * Verifica si WhatsApp está habilitado
   */
  isEnabled(): boolean {
    const { token, phoneId } = this.getCredentials();
    return !!token && !!phoneId;
  }

  /**
   * Formatea número al formato internacional de Meta (ej: 519XXXXXXXX)
   */
  private formatearNumero(numero: string): string {
    let num = numero.replace(/\D/g, '');

    // Si tiene 9 dígitos, asumir Perú (+51)
    if (num.length === 9) {
      num = '51' + num;
    }

    return num;
  }

  /**
   * Envía un mensaje de texto libre (requiere ventana activa de 24h o template aprobado).
   * Si se pasa `empresaId`, envía desde el número WhatsApp propio de esa empresa
   * (multi-tenant); si no, usa las credenciales de plataforma (comportamiento previo).
   */
  async enviarTexto(
    numero: string,
    mensaje: string,
    empresaId?: number,
  ): Promise<{ success: boolean; error?: string }> {
    let token: string;
    let phoneId: string;
    if (empresaId) {
      try {
        ({ token, phoneId } = await this.getCredentialsForEmpresa(empresaId));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'WhatsApp no configurado';
        return { success: false, error: msg };
      }
    } else {
      ({ token, phoneId } = this.getCredentials());
    }
    if (!token || !phoneId)
      return { success: false, error: 'WhatsApp no configurado' };

    const to = this.formatearNumero(numero);
    try {
      await axios.post(
        `${this.apiUrl}/${phoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: mensaje },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return { success: true };
    } catch (error) {
      const msg = error.response?.data?.error?.message || error.message;
      this.logger.warn(`WhatsApp texto fallido a ${to}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Envía una IMAGEN por URL (con caption opcional). Útil para mandar la foto del
   * producto en la conversación de la IA de Ventas. Dentro de la ventana de 24h
   * es un mensaje de servicio (libre, sin costo de plantilla).
   */
  async enviarImagenUrl(
    numero: string,
    imagenUrl: string,
    caption: string | undefined,
    empresaId?: number,
  ): Promise<{ success: boolean; error?: string }> {
    let token: string;
    let phoneId: string;
    if (empresaId) {
      try {
        ({ token, phoneId } = await this.getCredentialsForEmpresa(empresaId));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'WhatsApp no configurado';
        return { success: false, error: msg };
      }
    } else {
      ({ token, phoneId } = this.getCredentials());
    }
    if (!token || !phoneId)
      return { success: false, error: 'WhatsApp no configurado' };

    const to = this.formatearNumero(numero);
    try {
      // WhatsApp solo acepta jpeg/png en mensajes de imagen. Si la URL ya es
      // jpg/png, se envía por link (rápido). Si no (webp, etc.), se descarga, se
      // convierte a JPG con sharp, se sube a la Media API y se envía por id.
      let image: any;
      if (/\.(jpe?g|png)(\?|$)/i.test(imagenUrl)) {
        image = { link: imagenUrl, ...(caption ? { caption } : {}) };
      } else {
        const resp = await axios.get<ArrayBuffer>(imagenUrl, {
          responseType: 'arraybuffer',
        });
        const jpg = await sharp(Buffer.from(resp.data))
          .jpeg({ quality: 82 })
          .toBuffer();
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('file', jpg, {
          filename: 'producto.jpg',
          contentType: 'image/jpeg',
        });
        const up = await axios.post(
          `${this.apiUrl}/${phoneId}/media`,
          form,
          {
            headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
          },
        );
        image = { id: up.data?.id, ...(caption ? { caption } : {}) };
      }

      await axios.post(
        `${this.apiUrl}/${phoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'image',
          image,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return { success: true };
    } catch (error) {
      const msg = error.response?.data?.error?.message || error.message;
      this.logger.warn(`WhatsApp imagen fallida a ${to}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Envía una PLANTILLA aprobada por Meta. A diferencia de `enviarTexto`, funciona
   * para mensajes que inicia el negocio FUERA de la ventana de 24h (postventa) sin
   * riesgo de bloqueo. La plantilla debe estar creada y aprobada en WhatsApp Manager,
   * con el mismo nombre, idioma y orden de variables ({{1}}, {{2}}, …).
   */
  async enviarPlantilla(
    numero: string,
    plantilla: string,
    idioma: string,
    parametros: string[],
    empresaId?: number,
  ): Promise<{ success: boolean; mensajeId?: string; error?: string }> {
    const { token, phoneId } = empresaId
      ? await this.getCredentialsForEmpresa(empresaId)
      : this.getCredentials();
    if (!token || !phoneId)
      return { success: false, error: 'WhatsApp no configurado' };

    const to = this.formatearNumero(numero);
    const components = parametros.length
      ? [
          {
            type: 'body',
            parameters: parametros.map((texto) => ({ type: 'text', text: texto })),
          },
        ]
      : undefined;

    try {
      const res = await axios.post(
        `${this.apiUrl}/${phoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: {
            name: plantilla,
            language: { code: idioma },
            ...(components ? { components } : {}),
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const mensajeId = res.data?.messages?.[0]?.id;
      return { success: true, mensajeId };
    } catch (error) {
      const msg = error.response?.data?.error?.message || error.message;
      this.logger.warn(`WhatsApp plantilla ${plantilla} fallida a ${to}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Envía un documento (PDF por URL) por WhatsApp. Si se pasa `empresaId`, usa las
   * credenciales de esa empresa (BYON); si no, las de plataforma.
   */
  async enviarDocumentoUrl(
    numero: string,
    pdfUrl: string,
    filename: string,
    caption?: string,
    empresaId?: number,
  ): Promise<{ success: boolean; error?: string }> {
    let token: string;
    let phoneId: string;
    if (empresaId) {
      try {
        ({ token, phoneId } = await this.getCredentialsForEmpresa(empresaId));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'WhatsApp no configurado';
        return { success: false, error: msg };
      }
    } else {
      ({ token, phoneId } = this.getCredentials());
    }
    if (!token || !phoneId)
      return { success: false, error: 'WhatsApp no configurado' };
    const to = this.formatearNumero(numero);
    try {
      await axios.post(
        `${this.apiUrl}/${phoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'document',
          document: { link: pdfUrl, caption, filename },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return { success: true };
    } catch (error) {
      const msg = error.response?.data?.error?.message || error.message;
      this.logger.warn(`WhatsApp documento fallido a ${to}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Envía comprobante por WhatsApp usando Meta Cloud API
   */
  async enviarComprobante(
    params: EnviarComprobanteParams,
  ): Promise<{ success: boolean; mensajeId?: string; error?: string }> {
    const {
      comprobanteId,
      empresaId,
      usuarioId,
      numeroDestino,
      pdfUrl,
      empresaNombre,
      tipoDoc,
      serie,
      correlativo,
      monto,
      incluyeXML,
    } = params;

    try {
      const { token, phoneId, source } =
        await this.getCredentialsForEmpresa(empresaId);
      const to = this.formatearNumero(numeroDestino);

      const tipoDocumento =
        tipoDoc === '01'
          ? 'Factura'
          : tipoDoc === '03'
            ? 'Boleta'
            : 'Comprobante';
      const correlativoStr = `${serie}-${String(correlativo).padStart(8, '0')}`;
      const mensaje = `🧾 *${empresaNombre}*\nAdjuntamos tu ${tipoDocumento} ${correlativoStr} por el monto de S/ ${monto.toFixed(2)}.\n\nGracias por tu preferencia.`;

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'document',
        document: {
          link: pdfUrl,
          caption: mensaje,
          filename: `${correlativoStr}.pdf`,
        },
      };

      const response = await axios.post(
        `${this.apiUrl}/${phoneId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const mensajeId = response.data.messages[0].id;

      // Registrar envío en BD
      await this.prisma.whatsAppEnvio.create({
        data: {
          comprobanteId,
          empresaId,
          usuarioId,
          numeroDestino: to,
          estado: 'ENVIADO',
          mensajeId,
          costoUSD: 0.01,
          incluyeXML,
        },
      });

      this.logger.log(`✅ WhatsApp enviado (Meta): ${mensajeId} a ${to}`);
      this.logger.log(`📲 WhatsApp source: ${source} empresaId=${empresaId}`);

      return { success: true, mensajeId };
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      this.logger.error(`❌ Error enviando WhatsApp (Meta): ${errorMsg}`);

      await this.prisma.whatsAppEnvio.create({
        data: {
          comprobanteId,
          empresaId,
          usuarioId,
          numeroDestino,
          estado: 'FALLIDO',
          error: errorMsg,
          incluyeXML,
        },
      });

      return { success: false, error: errorMsg };
    }
  }

  /**
   * Envía guía de remisión por WhatsApp
   */
  async enviarGuia(
    params: EnviarGuiaParams,
  ): Promise<{ success: boolean; mensajeId?: string; error?: string }> {
    const { guiaRemisionId, empresaId, usuarioId, numeroDestino, pdfUrl } =
      params;

    try {
      const { token, phoneId } = await this.getCredentialsForEmpresa(empresaId);
      const to = this.formatearNumero(numeroDestino);

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: 'hello_world',
          language: { code: 'en_US' },
        },
      };

      const response = await axios.post(
        `${this.apiUrl}/${phoneId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const mensajeId = response.data.messages[0].id;

      await this.prisma.whatsAppEnvio.create({
        data: {
          guiaRemisionId,
          empresaId,
          usuarioId,
          numeroDestino: to,
          estado: 'ENVIADO',
          mensajeId,
          costoUSD: 0.01,
        },
      });

      return { success: true, mensajeId };
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      this.logger.error(`❌ Error WhatsApp Guía: ${errorMsg}`);

      await this.prisma.whatsAppEnvio.create({
        data: {
          guiaRemisionId,
          empresaId,
          usuarioId,
          numeroDestino,
          estado: 'FALLIDO',
          error: errorMsg,
        },
      });

      return { success: false, error: errorMsg };
    }
  }

  async obtenerHistorialEmpresa(
    empresaId: number,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;
    const [envios, total] = await Promise.all([
      this.prisma.whatsAppEnvio.findMany({
        where: { empresaId },
        include: {
          comprobante: {
            select: {
              tipoDoc: true,
              serie: true,
              correlativo: true,
              cliente: true,
            },
          },
          usuario: { select: { nombre: true } },
        },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.whatsAppEnvio.count({ where: { empresaId } }),
    ]);
    return {
      data: envios,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Obtiene el costo total de una empresa en un período
   */
  async obtenerCostoEmpresa(
    empresaId: number,
    fechaInicio: Date,
    fechaFin: Date,
  ) {
    const resultado = await this.prisma.whatsAppEnvio.aggregate({
      where: {
        empresaId,
        creadoEn: {
          gte: fechaInicio,
          lte: fechaFin,
        },
      },
      _sum: {
        costoUSD: true,
      },
      _count: true,
    });

    return {
      empresaId,
      cantidadEnvios: resultado._count,
      costoTotalUSD: Number(resultado._sum.costoUSD || 0),
      periodo: {
        inicio: fechaInicio,
        fin: fechaFin,
      },
    };
  }

  /**
   * Obtiene estadísticas globales (solo ADMIN_SISTEMA)
   */
  async obtenerEstadisticasGlobales(fechaInicio?: Date, fechaFin?: Date) {
    const where: any = {};
    if (fechaInicio && fechaFin) {
      where.creadoEn = { gte: fechaInicio, lte: fechaFin };
    }

    const [totalEnvios, enviosPorEstado, costoTotal, enviosPorEmpresa] =
      await Promise.all([
        this.prisma.whatsAppEnvio.count({ where }),
        this.prisma.whatsAppEnvio.groupBy({
          by: ['estado'],
          where,
          _count: true,
        }),
        this.prisma.whatsAppEnvio.aggregate({
          where,
          _sum: { costoUSD: true },
        }),
        this.prisma.whatsAppEnvio.groupBy({
          by: ['empresaId'],
          where,
          _count: true,
          orderBy: { _count: { empresaId: 'desc' } },
          take: 10,
        }),
      ]);

    const empresaIds = enviosPorEmpresa.map((e) => e.empresaId);
    const empresas = await this.prisma.empresa.findMany({
      where: { id: { in: empresaIds } },
      select: { id: true, razonSocial: true, ruc: true },
    });

    const empresasMap = new Map(empresas.map((e) => [e.id, e]));

    return {
      totalEnvios,
      enviosPorEstado: enviosPorEstado.map((e) => ({
        estado: e.estado,
        cantidad: e._count,
      })),
      costoTotalUSD: Number(costoTotal._sum.costoUSD || 0),
      topEmpresas: enviosPorEmpresa.map((e) => ({
        empresaId: e.empresaId,
        empresa: empresasMap.get(e.empresaId),
        cantidadEnvios: e._count,
      })),
    };
  }
}
