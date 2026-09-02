import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import type { CalificacionBant } from './leads-ia.service';

export interface AlertaLeadParams {
  empresaId: number;
  empresaNombre: string;
  prospectoId: number;
  nombreProspecto: string;
  telefonoProspecto: string;
  cal: CalificacionBant;
}

/**
 * Alerta multicanal de lead caliente al vendedor (además de la notificación
 * in-app): correo (Resend + React Email) y WhatsApp al celular del admin.
 * Todo es best-effort: nunca lanza; registra errores y sigue.
 */
@Injectable()
export class LeadsAlertaService {
  private readonly logger = new Logger(LeadsAlertaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly config: ConfigService,
  ) {}

  async alertarLeadCaliente(p: AlertaLeadParams): Promise<void> {
    const admins = await this.prisma.usuario.findMany({
      where: { empresaId: p.empresaId, rol: 'ADMIN_EMPRESA' },
      select: { nombre: true, email: true, celular: true },
    });
    if (admins.length === 0) return;

    const panelUrl = `${this.frontendUrl()}/administrador/leads`;
    const texto = this.mensajeWhatsApp(p, panelUrl);

    const tareas: Promise<unknown>[] = [];
    for (const admin of admins) {
      // Correo
      if (admin.email) {
        tareas.push(
          this.enviarEmail(admin.nombre, admin.email, p, panelUrl).catch((e) =>
            this.logger.warn(
              `Alerta lead caliente: email a ${admin.email} falló: ${e?.message}`,
            ),
          ),
        );
      }
      // WhatsApp al celular del admin (best-effort: puede fallar fuera de la
      // ventana de 24h si no hay plantilla aprobada).
      if (admin.celular) {
        tareas.push(
          this.whatsapp
            .enviarTexto(admin.celular, texto, p.empresaId)
            .then((r) => {
              if (!r.success) {
                this.logger.warn(
                  `Alerta lead caliente: WhatsApp a ${admin.celular} falló: ${r.error}`,
                );
              }
            })
            .catch((e) =>
              this.logger.warn(
                `Alerta lead caliente: WhatsApp a ${admin.celular} error: ${e?.message}`,
              ),
            ),
        );
      }
    }

    await Promise.allSettled(tareas);
  }

  private frontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL') ||
      process.env.FRONTEND_URL ||
      'https://app.falconext.pe'
    ).replace(/\/$/, '');
  }

  private mensajeWhatsApp(p: AlertaLeadParams, panelUrl: string): string {
    const waProspecto = `https://wa.me/${p.telefonoProspecto.replace(/\D/g, '')}`;
    const s = p.cal.score;
    return [
      '🔥 *LEAD CALIENTE* 🔥',
      '',
      `👤 *${p.nombreProspecto}*`,
      `📱 ${waProspecto}`,
      `⭐ Score *${s.total}/100* (B${s.budget} A${s.authority} N${s.need} T${s.timeline})`,
      '',
      p.cal.resumen ? `📋 ${p.cal.resumen}` : null,
      p.cal.proximaAccion ? `👉 ${p.cal.proximaAccion}` : null,
      '',
      `Escríbele ahora: ${waProspecto}`,
      `Ver en el panel: ${panelUrl}`,
    ]
      .filter((l) => l !== null)
      .join('\n');
  }

  private async enviarEmail(
    nombreAdmin: string,
    email: string,
    p: AlertaLeadParams,
    panelUrl: string,
  ): Promise<void> {
    const resendKey =
      this.config.get<string>('RESEND_API_KEY') || process.env.RESEND_API_KEY;
    if (!resendKey) return; // sin clave → se omite el correo (no es error)

    const fromEmail =
      this.config.get<string>('RESEND_FROM_EMAIL') ||
      process.env.RESEND_FROM_EMAIL ||
      'notificaciones@falconext.pe';
    const appName =
      this.config.get<string>('APP_NAME') || process.env.APP_NAME || 'Falconext';

    const { Resend } = await import('resend');
    const { render } = await import('@react-email/components');
    const { LeadCalienteEmail } = await import('./emails/LeadCalienteEmail');

    const html = await render(
      LeadCalienteEmail({
        nombreAdmin,
        nombreProspecto: p.nombreProspecto,
        telefonoProspecto: p.telefonoProspecto,
        puntaje: p.cal.score.total,
        presupuesto: p.cal.score.budget,
        autoridad: p.cal.score.authority,
        necesidad: p.cal.score.need,
        plazo: p.cal.score.timeline,
        resumen: p.cal.resumen,
        puntosClave: p.cal.puntosClave,
        proximaAccion: p.cal.proximaAccion,
        panelUrl,
        appName,
      }) as any,
    );

    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from: `${appName} <${fromEmail}>`,
      to: [email],
      subject: `🔥 Lead caliente: ${p.nombreProspecto} — Score ${p.cal.score.total}/100`,
      html,
    });
    if (error) throw new Error(String((error as any)?.message ?? error));
  }
}
