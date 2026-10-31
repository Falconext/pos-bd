import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { numerosInternos } from '../leads/numeros-internos';
import {
  fechaHoraLima,
  fechaLima,
  montoTexto,
} from './libro-reclamaciones.documentos';
import type { Reclamo } from './libro-reclamaciones.reglas';
import type { LibroReclamacionEmailProps } from './emails/LibroReclamacionEmail';

interface Contacto {
  email: string;
  celular: string;
}

interface Correo {
  para: string | string[];
  asunto: string;
  remitente: string;
  props: LibroReclamacionEmailProps;
  adjunto?: { nombre: string; contenido: Buffer };
}

export interface ResumenVencimientos {
  empresaId: number;
  vencidos: string[];
  porVencer: string[];
}

/**
 * Avisos del Libro de Reclamaciones: correos (Resend), notificación del panel
 * (web + app por WebSocket) y WhatsApp a los administradores. Nada de esto
 * puede tumbar el registro de una hoja: cada canal falla por su cuenta y solo
 * deja el error en el log.
 */
@Injectable()
export class LibroReclamacionesAvisosService {
  private readonly logger = new Logger(LibroReclamacionesAvisosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificaciones: NotificacionesService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private panelUrl(): string {
    const base =
      process.env.APP_URL ||
      process.env.FRONTEND_URL ||
      'https://app.falconext.pe';
    return `${base.replace(/\/$/, '')}/administrador/libro-reclamaciones`;
  }

  private async enviarCorreo(c: Correo): Promise<void> {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      this.logger.warn(
        `Correo "${c.asunto}" no enviado: falta RESEND_API_KEY.`,
      );
      return;
    }
    const fromEmail =
      process.env.RESEND_FROM_EMAIL ||
      process.env.MAIL_FROM ||
      'noreply@falconext.pe';
    const { Resend } = await import('resend');
    const { render } = await import('@react-email/render');
    const { LibroReclamacionEmail } = await import(
      './emails/LibroReclamacionEmail.js'
    );
    const html = await render(LibroReclamacionEmail(c.props));
    const { error } = await new Resend(resendKey).emails.send({
      from: `${c.remitente.replace(/[<>"]/g, '')} <${fromEmail}>`,
      to: c.para,
      subject: c.asunto,
      html,
      attachments: c.adjunto
        ? [
            {
              filename: c.adjunto.nombre,
              content: c.adjunto.contenido,
              contentType: 'application/pdf',
            },
          ]
        : undefined,
    });
    if (error) throw new Error(error.message);
  }

  private async administradores(empresaId: number): Promise<Contacto[]> {
    return this.prisma.usuario.findMany({
      where: { empresaId, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
      select: { email: true, celular: true },
      orderBy: { id: 'asc' },
    });
  }

  private async avisarPorWhatsApp(
    empresaId: number,
    celulares: (string | null)[],
    texto: string,
  ) {
    const destinos = numerosInternos(celulares);
    await Promise.allSettled(
      destinos.map(async (numero) => {
        // Con Takiy sale desde el número del negocio sin ventana de 24 h; si no,
        // texto libre por Meta (solo llega si la ventana está abierta).
        if (await this.whatsapp.credencialesTakiy(empresaId)) {
          const t = await this.whatsapp.enviarPorTakiy(
            empresaId,
            numero,
            texto,
          );
          if (t.success) return;
        }
        const r = await this.whatsapp.enviarTexto(numero, texto, empresaId);
        if (!r.success) {
          this.logger.warn(
            `WhatsApp de libro de reclamaciones a ${numero} no salió: ${r.error}`,
          );
        }
      }),
    );
  }

  private async intentar(que: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(
        `${que} falló: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Al registrar: constancia al consumidor y avisos a la empresa. */
  async alRegistrar(
    empresaId: number,
    r: Reclamo,
    pdf: () => Promise<Buffer>,
  ): Promise<void> {
    const tienda = r.proveedor.nombreComercial || r.proveedor.razonSocial;
    const tipo = r.tipo === 'QUEJA' ? 'queja' : 'reclamo';
    const filas = [
      { etiqueta: 'Código', valor: r.codigo },
      { etiqueta: 'Fecha de registro', valor: fechaHoraLima(r.fecha) },
      { etiqueta: 'Respuesta a más tardar', valor: fechaLima(r.fechaLimite) },
      { etiqueta: 'Tipo', valor: r.tipo === 'QUEJA' ? 'Queja' : 'Reclamo' },
    ];

    await this.intentar(`Constancia ${r.codigo} al consumidor`, async () => {
      const contenido = await pdf();
      await this.enviarCorreo({
        para: r.email,
        remitente: tienda,
        asunto: `Hoja de reclamación ${r.codigo} — ${tienda}`,
        adjunto: { nombre: `hoja-reclamacion-${r.codigo}.pdf`, contenido },
        props: {
          remitente: tienda,
          preview: `Registramos tu ${tipo} ${r.codigo}`,
          eyebrow: 'Libro de Reclamaciones',
          titulo: `Registramos tu ${tipo}`,
          parrafos: [
            `Hola ${r.nombres}, ${tienda} recibió tu hoja de reclamación. Adjuntamos la constancia en PDF.`,
            'El proveedor debe responderte en un plazo máximo de 15 días hábiles.',
          ],
          filas,
          pie: `${r.proveedor.razonSocial} · RUC ${r.proveedor.ruc}`,
        },
      });
    });

    const admins = await this.administradores(empresaId).catch(
      (): Contacto[] => [],
    );

    await this.intentar(`Notificación de la hoja ${r.codigo}`, () =>
      this.notificaciones.notificarAdminsEmpresa({
        empresaId,
        tipo: 'WARNING',
        titulo: `📕 Nuevo ${tipo} en el Libro de Reclamaciones`,
        mensaje: `${r.nombres} registró el ${tipo} ${r.codigo}. Respóndelo a más tardar el ${fechaLima(r.fechaLimite)}.`,
        metaData: { libroReclamacionId: r.id, codigo: r.codigo, tipo: r.tipo },
      }),
    );

    const correos = admins.map((a) => a.email).filter((e): e is string => !!e);
    if (correos.length > 0) {
      await this.intentar(`Correo a la empresa por la hoja ${r.codigo}`, () =>
        this.enviarCorreo({
          para: correos,
          remitente: 'Libro de Reclamaciones',
          asunto: `📕 Nuevo ${tipo} ${r.codigo} — responde antes del ${fechaLima(r.fechaLimite)}`,
          props: {
            remitente: tienda,
            preview: `${r.nombres} registró el ${tipo} ${r.codigo}`,
            eyebrow: 'Libro de Reclamaciones',
            titulo: `Nuevo ${tipo} ${r.codigo}`,
            parrafos: [
              `${r.nombres} registró un ${tipo} en el libro de ${tienda}.`,
              `Por ley tienes hasta el ${fechaLima(r.fechaLimite)} (15 días hábiles) para responder. Respóndelo desde ${this.panelUrl()}`,
            ],
            filas: [
              ...filas,
              { etiqueta: 'Producto o servicio', valor: r.bienDescripcion },
              {
                etiqueta: 'Monto reclamado',
                valor: montoTexto(r.montoReclamado),
              },
            ],
            bloque: { titulo: 'Detalle', texto: r.detalle },
            pie: 'Aviso automático del Libro de Reclamaciones virtual.',
          },
        }),
      );
    }

    await this.intentar(`WhatsApp por la hoja ${r.codigo}`, () =>
      this.avisarPorWhatsApp(
        empresaId,
        admins.map((a) => a.celular),
        [
          `📕 *Nuevo ${tipo} en el Libro de Reclamaciones*`,
          `${r.codigo} · ${r.nombres}`,
          `Responde a más tardar el ${fechaLima(r.fechaLimite)} (15 días hábiles).`,
          this.panelUrl(),
        ].join('\n'),
      ),
    );
  }

  /** Al responder: la respuesta le llega al consumidor por correo. */
  async alResponder(r: Reclamo): Promise<void> {
    const tienda = r.proveedor.nombreComercial || r.proveedor.razonSocial;
    await this.intentar(`Respuesta de la hoja ${r.codigo} al consumidor`, () =>
      this.enviarCorreo({
        para: r.email,
        remitente: tienda,
        asunto: `Respuesta a tu hoja de reclamación ${r.codigo} — ${tienda}`,
        props: {
          remitente: tienda,
          preview: `${tienda} respondió tu hoja ${r.codigo}`,
          eyebrow: 'Libro de Reclamaciones',
          titulo: 'Respondimos tu hoja de reclamación',
          parrafos: [
            `Hola ${r.nombres}, esta es la respuesta de ${tienda} a tu hoja ${r.codigo}.`,
          ],
          filas: [
            { etiqueta: 'Código', valor: r.codigo },
            { etiqueta: 'Fecha de registro', valor: fechaHoraLima(r.fecha) },
            {
              etiqueta: 'Fecha de respuesta',
              valor: fechaHoraLima(r.fechaRespuesta),
            },
          ],
          bloque: { titulo: 'Respuesta', texto: r.respuesta ?? '' },
          pie: `${r.proveedor.razonSocial} · RUC ${r.proveedor.ruc}`,
        },
      }),
    );
  }

  /** Aviso diario al dueño: hojas vencidas y por vencer (≤ 3 días hábiles). */
  async avisarVencimientos(resumen: ResumenVencimientos): Promise<void> {
    const { empresaId, vencidos, porVencer } = resumen;
    if (vencidos.length === 0 && porVencer.length === 0) return;
    const partes: string[] = [];
    if (vencidos.length)
      partes.push(
        `${vencidos.length} vencida(s): ${vencidos.slice(0, 10).join(', ')}`,
      );
    if (porVencer.length)
      partes.push(
        `${porVencer.length} por vencer: ${porVencer.slice(0, 10).join(', ')}`,
      );
    const mensaje = `Libro de Reclamaciones — ${partes.join(' · ')}. Respóndelas para no incumplir el plazo legal.`;

    await this.intentar(
      `Aviso diario de vencimientos (empresa ${empresaId})`,
      () =>
        this.notificaciones.notificarAdminsEmpresa({
          empresaId,
          tipo: vencidos.length ? 'CRITICAL' : 'WARNING',
          titulo: vencidos.length
            ? '⏰ Tienes reclamos vencidos sin responder'
            : '⏰ Reclamos por vencer',
          mensaje,
          metaData: {
            libroReclamaciones: true,
            vencidos: vencidos.length,
            porVencer: porVencer.length,
          },
        }),
    );

    const admins = await this.administradores(empresaId).catch(
      (): Contacto[] => [],
    );
    const correos = admins.map((a) => a.email).filter((e): e is string => !!e);
    if (correos.length > 0) {
      await this.intentar(
        `Correo diario de vencimientos (empresa ${empresaId})`,
        () =>
          this.enviarCorreo({
            para: correos,
            remitente: 'Libro de Reclamaciones',
            asunto: vencidos.length
              ? `⏰ ${vencidos.length} reclamo(s) vencido(s) sin responder`
              : `⏰ ${porVencer.length} reclamo(s) por vencer`,
            props: {
              remitente: 'Libro de Reclamaciones',
              preview: mensaje,
              eyebrow: 'Libro de Reclamaciones',
              titulo: 'Reclamos que necesitan respuesta',
              parrafos: [
                'El plazo legal para responder es de 15 días hábiles.',
                `Respóndelos desde ${this.panelUrl()}`,
              ],
              filas: [
                { etiqueta: 'Vencidos', valor: vencidos.join(', ') || '—' },
                {
                  etiqueta: 'Por vencer (≤ 3 días hábiles)',
                  valor: porVencer.join(', ') || '—',
                },
              ],
              pie: 'Aviso automático del Libro de Reclamaciones virtual.',
            },
          }),
      );
    }

    await this.intentar(
      `WhatsApp diario de vencimientos (empresa ${empresaId})`,
      () =>
        this.avisarPorWhatsApp(
          empresaId,
          admins.map((a) => a.celular),
          `⏰ ${mensaje}\n${this.panelUrl()}`,
        ),
    );
  }
}
