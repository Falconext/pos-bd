import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { JOB_INGRESAR_MENSAJE, LEADS_MESSAGES_QUEUE } from './leads.constants';
import {
  mensajesDeInstagram,
  mensajesDeMessenger,
} from '../instagram/instagram-webhook';
import { ecosDeCambio, JOB_ECO_VENDEDOR } from './eco-vendedor';
import { LeadsPlantillasService } from './leads-plantillas.service';
import { LeadsEnviosService } from './leads-envios.service';

/**
 * Webhook público de WhatsApp Cloud API para el módulo de leads.
 * Meta llama aquí; validamos la firma HMAC y encolamos cada mensaje entrante.
 * NO lleva JwtAuthGuard (Meta no envía token). El ruteo a la empresa se hace en
 * el processor por phone_number_id → Empresa.whatsappPhoneNumberId.
 */
@Controller('leads')
export class LeadsWebhookController {
  private readonly logger = new Logger(LeadsWebhookController.name);

  constructor(
    @InjectQueue(LEADS_MESSAGES_QUEUE) private readonly queue: Queue,
    private readonly plantillas: LeadsPlantillasService,
    private readonly envios: LeadsEnviosService,
  ) {}

  // Verificación del webhook (Meta hace GET con hub.challenge).
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  /** Compara la firma contra UN secreto, en tiempo constante. */
  private coincideFirma(
    rawBody: Buffer,
    signature: string,
    secret: string,
  ): boolean {
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  }

  /**
   * Valida la firma del webhook aceptando también un secreto anterior
   * (`META_APP_SECRET_PREV`).
   *
   * Al restablecer la clave de la app, Meta sigue firmando un rato con la
   * anterior mientras dura su periodo de gracia. Si solo miramos la nueva,
   * TODOS los mensajes entrantes de TODOS los clientes se descartan durante esa
   * ventana — y el fallo es mudo: Meta recibe su 200 y en el panel no pasa nada.
   * Con las dos claves, la rotación no tiene corte: se pone la nueva en
   * META_APP_SECRET, la vieja en META_APP_SECRET_PREV, y se borra la segunda
   * cuando el periodo de gracia termina.
   */
  private firmaValida(
    rawBody: Buffer | undefined,
    signature?: string,
  ): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret) return true; // sin secreto configurado (dev) → no bloquear
    if (!signature) {
      // Sin firma: solo se permite fuera de producción (para pruebas manuales).
      return process.env.NODE_ENV !== 'production';
    }
    if (!rawBody) return false;
    if (this.coincideFirma(rawBody, signature, secret)) return true;

    // Los mensajes de Instagram (login de Instagram) los firma Meta con la
    // clave de la app de Instagram, que es otra.
    const deInstagram = process.env.INSTAGRAM_APP_SECRET;
    if (deInstagram && this.coincideFirma(rawBody, signature, deInstagram))
      return true;

    const anterior = process.env.META_APP_SECRET_PREV;
    if (anterior && this.coincideFirma(rawBody, signature, anterior)) {
      this.logger.warn(
        'Webhook leads: firma válida con META_APP_SECRET_PREV (rotación en curso); quita esa variable cuando Meta deje de usar la clave anterior.',
      );
      return true;
    }
    return false;
  }

  @Post('webhook')
  @HttpCode(200)
  async receive(@Req() req: Request, @Res() res: Response) {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!this.firmaValida((req as any).rawBody, signature)) {
      this.logger.warn('Webhook leads: firma inválida');
      return res.status(401).send('invalid signature');
    }

    const body: any = req.body ?? {};
    if (body.object === 'instagram' || body.object === 'page') {
      // Mismo trato que WhatsApp: se encola antes de contestar y, si la cola
      // falla, un 500 hace que Meta reentregue. `page` es Messenger.
      const mensajes =
        body.object === 'instagram'
          ? mensajesDeInstagram(body)
          : mensajesDeMessenger(body);
      try {
        for (const m of mensajes) {
          await this.queue.add(JOB_INGRESAR_MENSAJE, m, {
            // BullMQ no acepta ":" en el id del job.
            jobId: `in-${m.messageId.replace(/:/g, '-')}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: true,
          });
        }
      } catch (e: any) {
        this.logger.error(
          `Webhook leads (${body.object}): error encolando: ${e?.message}`,
        );
        return res.status(500).send('retry');
      }
      return res.status(200).send('EVENT_RECEIVED');
    }
    if (body.object !== 'whatsapp_business_account') {
      return res.status(200).send('EVENT_RECEIVED');
    }
    // Primero se encola y DESPUÉS se contesta. Antes el 200 salía primero: si
    // la cola fallaba, Meta ya tenía su OK y no reintentaba, y el mensaje se
    // perdía sin rastro (19-10, "Habla p Tone" al 915 con doble check y sin
    // conversación). Con un 500 Meta reentrega, y la reentrega no duplica:
    // el jobId sale del id del mensaje y LeadMensaje.whatsappMsgId es único.
    try {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          // Lo que el dueño contestó desde su celular (coexistencia). Solo
          // llega de números conectados así; en los demás esto no encola nada.
          for (const eco of ecosDeCambio(change)) {
            await this.queue.add(JOB_ECO_VENDEDOR, eco, {
              jobId: `eco-${eco.messageId}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnComplete: true,
              removeOnFail: true,
            });
          }
          const value = change.value ?? {};
          // Meta aprobó o rechazó una plantilla. No se encola: es una
          // actualización chica, y si falla la consulta periódica la recoge.
          if (change.field === 'message_template_status_update') {
            await this.plantillas
              .aplicarWebhook(String(entry.id), value)
              .catch((e) =>
                this.logger.warn(
                  `Webhook leads: estado de plantilla no aplicado: ${e?.message}`,
                ),
              );
            continue;
          }
          // Entregado / leído / falló de los mensajes que mandó el negocio.
          // Tampoco se encola: es un update por id y, si falla, se pierde
          // solo una métrica, no un mensaje.
          if (Array.isArray(value.statuses) && value.statuses.length) {
            await this.envios
              .registrarEstados(value.statuses)
              .catch((e) =>
                this.logger.warn(
                  `Webhook leads: estados no aplicados: ${e?.message}`,
                ),
              );
          }
          const phoneNumberId = value.metadata?.phone_number_id;
          const contactos: any[] = value.contacts ?? [];
          for (const msg of value.messages ?? []) {
            // Las imágenes y los documentos se aceptan aunque no se lean: un
            // cliente que manda el comprobante de pago tiene que llegar al
            // asesor, y antes ese mensaje se descartaba en silencio.
            const texto = textoDeMensaje(msg);
            if (texto === null) continue;
            // Con nombre de usuario (@nick) Meta puede omitir el teléfono:
            // `from` no viene y queda `from_user_id` (BSUID). Antes eso creaba
            // la conversación sin teléfono, fallaba y el mensaje se perdía
            // (19-10: "Hola", "Deseo info", "Responde basura" sin respuesta).
            const remitente: string | undefined = msg.from ?? msg.from_user_id;
            if (!remitente) {
              this.logger.warn(
                `Webhook leads: mensaje ${msg.id} sin remitente (ni from ni from_user_id); se ignora.`,
              );
              continue;
            }
            const contacto = contactos.find(
              (c) =>
                (msg.from && c.wa_id === msg.from) ||
                (msg.from_user_id && c.user_id === msg.from_user_id),
            );
            await this.queue.add(
              JOB_INGRESAR_MENSAJE,
              {
                phoneNumberId,
                from: remitente,
                // El @usuario (BSUID) aunque venga también el número: con él
                // se une la conversación que empezó sin número.
                bsuid: msg.from_user_id ?? contacto?.user_id,
                messageId: msg.id,
                text: texto,
                esAudio: msg.type === 'audio',
                esImagen: msg.type === 'image',
                esDocumento: msg.type === 'document',
                // El id del archivo sirve para los tres casos: transcribir la
                // nota de voz y bajar la imagen del voucher para que el
                // encargado pueda mirarlo antes de validar el pago.
                mediaId: msg.audio?.id ?? msg.image?.id ?? msg.document?.id,
                nombre: contacto?.profile?.name ?? contacto?.profile?.username,
                timestamp: msg.timestamp,
                // Si tocó un anuncio de Facebook/Instagram para escribir, su
                // primer mensaje trae de cuál vino.
                referral: msg.referral,
              },
              {
                // Meta reentrega el mismo mensaje cuando duda de nuestro 200.
                jobId: `in-${msg.id}`,
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                // El id tiene que liberarse al terminar: retenido en completados
                // o fallidos, una reentrega de Meta se descartaría en silencio.
                // La deduplicación de verdad la hace el índice único de
                // LeadMensaje.whatsappMsgId.
                removeOnComplete: true,
                removeOnFail: true,
              },
            );
          }
        }
      }
    } catch (e: any) {
      this.logger.error(`Webhook leads: error encolando: ${e?.message}`);
      return res.status(500).send('retry');
    }
    return res.status(200).send('EVENT_RECEIVED');
  }
}

/**
 * Qué texto representa un mensaje entrante, o `null` si es de un tipo que no
 * sabemos manejar.
 *
 * Las imágenes y documentos no se leen, pero sí se registran: el cliente que
 * manda su comprobante de pago espera respuesta, y antes su mensaje se
 * descartaba sin que nadie se enterara.
 */
function textoDeMensaje(msg: {
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
  image?: { id?: string; caption?: string };
  document?: { id?: string; caption?: string; filename?: string };
}): string | null {
  switch (msg.type) {
    case 'text':
      return msg.text?.body ?? '';
    // El cliente tocó un botón de respuesta rápida de una plantilla
    // ("Lo quiero", "Ver catálogo"). Antes se descartaba: justo la respuesta
    // de quien más interés mostró en un envío masivo.
    case 'button':
      return msg.button?.text ?? msg.button?.payload ?? '';
    case 'interactive':
      return (
        msg.interactive?.button_reply?.title ??
        msg.interactive?.list_reply?.title ??
        ''
      );
    case 'audio':
      return '';
    case 'image':
      return msg.image?.caption?.trim()
        ? `[el cliente envió una imagen] ${msg.image.caption.trim()}`
        : '[el cliente envió una imagen]';
    case 'document':
      return `[el cliente envió un documento${
        msg.document?.filename ? `: ${msg.document.filename}` : ''
      }]`;
    default:
      return null;
  }
}
