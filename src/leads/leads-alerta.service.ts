import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService, esBsuid } from '../whatsapp/whatsapp.service';
import type { CalificacionBant } from './leads-ia.service';
import { numerosInternos } from './numeros-internos';

export interface AvisoDerivacionParams {
  empresaId: number;
  telefonoProspecto: string;
  nombreProspecto?: string | null;
  /** Uno de MOTIVOS_DERIVACION. */
  motivo: string;
  /** Lo que el asesor necesita para retomar sin volver a preguntar. */
  detalle?: string;
  /**
   * Número del supervisor de ventas, si el negocio configuró uno distinto del
   * de sus administradores. En Hierba Sana coinciden.
   */
  supervisorTelefono?: string | null;
}

export interface AlertaLeadParams {
  empresaId: number;
  empresaNombre: string;
  prospectoId: number;
  nombreProspecto: string;
  telefonoProspecto: string;
  cal: CalificacionBant;
  /** Cotización (COT) que la IA generó desde el chat, si aplica. */
  cotizacion?: { codigo: string } | null;
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
          this.enviarAlEquipo(
            admin.celular,
            texto,
            `Lead caliente (${p.cal.score.total}/100)${p.cal.interes ? `: ${p.cal.interes}` : ''}`,
            p.nombreProspecto,
            p.telefonoProspecto,
            p.empresaId,
            'lead caliente',
          ),
        );
      }
    }

    await Promise.allSettled(tareas);
  }

  /**
   * Avisa por WhatsApp a quien atiende las derivaciones.
   *
   * La notificación in-app no alcanza: cuando la IA deriva deja de responder,
   * y si nadie mira el panel en ese momento el cliente se queda esperando a
   * una persona que no sabe que lo espera. El empresario de Hierba Sana lo
   * pidió con esas palabras — "que las notificaciones lleguen a casa
   * naturista", al 955947892, su supervisor de ventas.
   *
   * Va al supervisor configurado y, si no hay, a los administradores: el
   * número tiene que salir de la configuración de cada empresa, nunca del
   * código, o el siguiente cliente necesita un despliegue para recibir sus
   * propios avisos.
   *
   * Best-effort, como el resto de este servicio: una derivación no puede
   * fallar porque WhatsApp esté caído.
   */
  async avisarDerivacion(p: AvisoDerivacionParams): Promise<void> {
    await this.avisarAlSupervisor(
      p,
      this.mensajeDerivacion(p),
      'derivación',
      `Un cliente necesita una persona (${p.motivo.replace(/_/g, ' ')})${p.detalle?.trim() ? `: ${p.detalle.trim()}` : ''}`,
    );
  }

  /**
   * Un cliente avisó que va a pasar por la tienda. Va al mismo número que las
   * derivaciones: la campana sola no alcanzaba, el dueño de Hierba Sana no
   * se enteró de una visita del viernes porque no tenía el panel abierto
   * (28-10).
   */
  async avisarVisitaTienda(
    p: Omit<AvisoDerivacionParams, 'motivo'> & { titulo: string; mensaje: string },
  ): Promise<void> {
    const texto = [
      `*${p.titulo}*`,
      '',
      p.mensaje,
      '',
      `Ver visitas: ${this.frontendUrl()}/administrador/leads/visitas`,
    ].join('\n');
    await this.avisarAlSupervisor(
      { ...p, motivo: 'visita a la tienda' },
      texto,
      'visita a tienda',
      p.titulo.replace(/^\S+\s+/, ''),
    );
  }

  /**
   * Cliente de alto riesgo (medicación, enfermedad crónica, embarazo): llega
   * al mismo número que las derivaciones, pero la IA SIGUE respondiendo. Lo
   * que se pide es seguimiento, no tomar el chat.
   */
  async avisarAltoRiesgo(p: AvisoDerivacionParams): Promise<void> {
    await this.avisarAlSupervisor(
      p,
      this.mensajeAltoRiesgo(p),
      'alto riesgo',
      `Cliente de alto riesgo, hacer seguimiento: ${p.motivo}${p.detalle?.trim() ? `. Se le recomendó ${p.detalle.trim()}` : ''}`,
    );
  }

  /**
   * El prospecto ya tiene su demo: a ventas le llegan sus datos para
   * agendarle la demo en vivo. La IA sigue atendiendo.
   */
  async avisarDemo(
    p: AvisoDerivacionParams & {
      datos: {
        correo?: string;
        celular?: string;
        ruc?: string;
        razonSocial?: string;
        nombreComercial?: string;
        rubro?: string;
      };
      demo: string;
      aproximada: boolean;
    },
  ): Promise<void> {
    const wa = enlaceWhatsApp(p.telefonoProspecto);
    const d = p.datos;
    const texto = [
      '🎯 *DEMO ENTREGADA — AGENDAR DEMO EN VIVO*',
      '',
      `👤 *${p.nombreProspecto?.trim() || 'Sin nombre'}*`,
      `📱 ${d.celular?.trim() || wa}`,
      d.correo ? `✉️ ${d.correo}` : null,
      d.ruc ? `🧾 RUC ${d.ruc}${d.razonSocial ? ` · ${d.razonSocial}` : ''}` : '🧾 Sin RUC',
      d.nombreComercial ? `🏪 ${d.nombreComercial}` : null,
      d.rubro ? `📌 Rubro: ${d.rubro}` : null,
      `💻 Demo: *${p.demo}*${p.aproximada ? ' (la más parecida: su rubro no tiene demo propia)' : ''}`,
      '',
      'La IA sigue atendiendo. Escríbele para la demo en vivo:',
      wa,
    ]
      .filter((l) => l !== null)
      .join('\n');
    await this.avisarAlSupervisor(
      p,
      texto,
      'demo',
      `Demo de ${p.demo} entregada, agendar demo en vivo${d.rubro ? ` (${d.rubro})` : ''}`,
    );
  }

  private async avisarAlSupervisor(
    p: AvisoDerivacionParams,
    texto: string,
    que: string,
    resumen: string,
  ): Promise<void> {
    const admins = await this.prisma.usuario.findMany({
      where: { empresaId: p.empresaId, rol: 'ADMIN_EMPRESA' },
      select: { celular: true },
    });
    // El supervisor manda; los admins son el respaldo para que una empresa
    // que no configuró nada igual se entere.
    const destinos = p.supervisorTelefono?.trim()
      ? numerosInternos([p.supervisorTelefono])
      : numerosInternos(admins.map((a) => a.celular));
    if (destinos.length === 0) {
      this.logger.warn(
        `Aviso de ${que} de la empresa ${p.empresaId} sin número a quién avisar: configura el supervisor o el celular del administrador.`,
      );
      return;
    }

    await Promise.allSettled(
      destinos.map((numero) =>
        this.enviarAlEquipo(
          numero,
          texto,
          resumen,
          p.nombreProspecto ?? null,
          p.telefonoProspecto,
          p.empresaId,
          que,
        ),
      ),
    );
  }

  /**
   * Manda el aviso al equipo y, si WhatsApp lo rechaza, con plantilla.
   *
   * El texto libre solo llega si ese número le escribió al del negocio en las
   * últimas 24 horas. El supervisor de Hierba Sana no le escribía al 915 desde
   * el sábado: ninguno de los avisos del 19-10 (alto riesgo, derivaciones,
   * leads calientes) le llegó, y nadie lo notaba porque el fallo solo quedaba
   * en el log. La plantilla `aviso_equipo` (UTILITY), una vez aprobada por Meta, llega aunque la ventana esté cerrada.
   */
  private async enviarAlEquipo(
    numero: string,
    texto: string,
    resumen: string,
    nombreCliente: string | null,
    telefonoCliente: string,
    empresaId: number,
    que: string,
  ): Promise<void> {
    try {
      const r = await this.whatsapp.enviarTexto(numero, texto, empresaId);
      if (r.success) return;
      const cliente = `${nombreCliente?.trim() || 'Sin nombre'} · ${
        esBsuid(telefonoCliente) ? 'usuario con @nick' : telefonoCliente
      }`;
      const plantilla = await this.whatsapp.enviarPlantilla(
        numero,
        'aviso_equipo',
        'es',
        [paraPlantilla(resumen), paraPlantilla(cliente)],
        empresaId,
      );
      if (!plantilla.success) {
        this.logger.warn(
          `Aviso de ${que} a ${numero}: falló el texto (${r.error}) y la plantilla (${plantilla.error}).`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`Aviso de ${que} a ${numero} error: ${e?.message}`);
    }
  }

  private mensajeAltoRiesgo(p: AvisoDerivacionParams): string {
    const wa = enlaceWhatsApp(p.telefonoProspecto);
    return [
      '⚠️ *CLIENTE DE ALTO RIESGO — HACER SEGUIMIENTO*',
      '',
      `👤 *${p.nombreProspecto?.trim() || 'Sin nombre'}*`,
      `📱 ${wa}`,
      `🩺 ${p.motivo}`,
      p.detalle?.trim() ? `💊 Se le recomendó: ${p.detalle.trim()}` : null,
      '',
      'La IA sigue atendiendo y ya le dijo que consulte con su médico y no deje su tratamiento. Escríbele para acompañarlo:',
      wa,
      `Ver en el panel: ${this.frontendUrl()}/administrador/leads`,
    ]
      .filter((l) => l !== null)
      .join('\n');
  }

  private mensajeDerivacion(p: AvisoDerivacionParams): string {
    const wa = enlaceWhatsApp(p.telefonoProspecto);
    return [
      '🙋 *UN CLIENTE NECESITA UNA PERSONA*',
      '',
      `👤 *${p.nombreProspecto?.trim() || 'Sin nombre'}*`,
      `📱 ${wa}`,
      `📌 Motivo: *${p.motivo.replace(/_/g, ' ')}*`,
      '',
      p.detalle?.trim() ? `📝 ${p.detalle.trim()}` : null,
      '',
      // Desde la bandeja se le contesta con el número del negocio; con el
      // wa.me le escribía alguien desde su WhatsApp personal y el cliente
      // terminaba hablando con otro número.
      'La IA dejó de responder en ese chat. Contéstale desde la bandeja, con el número del negocio:',
      `${this.frontendUrl()}/administrador/leads/chats`,
    ]
      .filter((l) => l !== null)
      .join('\n');
  }

  private frontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL') ||
      process.env.FRONTEND_URL ||
      'https://app.falconext.pe'
    ).replace(/\/$/, '');
  }

  private mensajeWhatsApp(p: AlertaLeadParams, panelUrl: string): string {
    const waProspecto = enlaceWhatsApp(p.telefonoProspecto);
    const s = p.cal.score;
    return [
      '🔥 *LEAD CALIENTE* 🔥',
      '',
      `👤 *${p.nombreProspecto}*`,
      `📱 ${waProspecto}`,
      `⭐ Score *${s.total}/100* (B${s.budget} A${s.authority} N${s.need} T${s.timeline})`,
      '',
      p.cal.interes ? `🛒 *Interés:* ${p.cal.interes}` : null,
      p.cotizacion
        ? `📄 *Cotización lista:* ${p.cotizacion.codigo} (borrador en el panel)`
        : null,
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
      this.config.get<string>('APP_NAME') ||
      process.env.APP_NAME ||
      'Falconext';

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
        interes: p.cal.interes,
        cotizacionCodigo: p.cotizacion?.codigo ?? null,
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

/**
 * Enlace para escribirle al cliente. A un usuario que llegó sin número (solo
 * con su id de WhatsApp, por tener @nick) no se le puede abrir un wa.me: se
 * le contesta desde el panel.
 */
function enlaceWhatsApp(telefono: string | null | undefined): string {
  if (esBsuid(telefono)) return 'sin número (usuario con @nick): respóndele desde el panel';
  return `https://wa.me/${String(telefono ?? '').replace(/\D/g, '')}`;
}

/**
 * Un parámetro de plantilla no admite saltos de línea, tabulaciones ni más
 * de cuatro espacios seguidos (Meta rechaza el envío entero).
 */
function paraPlantilla(texto: string): string {
  return texto.replace(/[\n\t]+/g, ' · ').replace(/\s{2,}/g, ' ').trim().slice(0, 900);
}
