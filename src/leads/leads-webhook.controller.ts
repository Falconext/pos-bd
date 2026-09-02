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
import { LEADS_MESSAGES_QUEUE } from './leads.constants';

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

  private firmaValida(rawBody: Buffer | undefined, signature?: string): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret) return true; // sin secreto configurado (dev) → no bloquear
    if (!signature) {
      // Sin firma: solo se permite fuera de producción (para pruebas manuales).
      return process.env.NODE_ENV !== 'production';
    }
    if (!rawBody) return false;
    const expected =
      'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
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
    // Meta siempre espera 200 rápido; encolamos y respondemos.
    res.status(200).send('EVENT_RECEIVED');

    if (body.object !== 'whatsapp_business_account') return;
    try {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value ?? {};
          const phoneNumberId = value.metadata?.phone_number_id;
          const contactos: any[] = value.contacts ?? [];
          for (const msg of value.messages ?? []) {
            if (msg.type !== 'text' && msg.type !== 'audio') continue;
            const contacto = contactos.find((c) => c.wa_id === msg.from);
            await this.queue.add(
              'incoming',
              {
                phoneNumberId,
                from: msg.from,
                messageId: msg.id,
                text: msg.text?.body ?? '',
                esAudio: msg.type === 'audio',
                mediaId: msg.audio?.id,
                nombre: contacto?.profile?.name,
                timestamp: msg.timestamp,
              },
              { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
            );
          }
        }
      }
    } catch (e: any) {
      this.logger.error(`Webhook leads: error encolando: ${e?.message}`);
    }
  }
}
