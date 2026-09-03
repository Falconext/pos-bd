import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { IaVentasService, MensajeConversacion } from './leads-ia.service';

/**
 * Seguimiento automático de la IA de Ventas.
 *
 * Cada 30 min busca conversaciones donde el prospecto dejó de responder (el
 * último mensaje es del ASISTENTE) y, si pasó suficiente silencio pero seguimos
 * DENTRO de la ventana de 24h de WhatsApp (mensaje libre, sin costo de
 * plantilla), envía UN reenganche generado por la IA. Máximo un seguimiento por
 * silencio: `seguimientos` se reinicia a 0 cuando el prospecto vuelve a escribir
 * (en el processor), así que aquí solo actuamos cuando está en 0.
 */
@Injectable()
export class LeadsSeguimientoService {
  private readonly logger = new Logger(LeadsSeguimientoService.name);

  // Silencio mínimo antes de reenganchar, y ventana libre de WhatsApp.
  private static readonly MIN_SILENCIO_HORAS = 4;
  private static readonly VENTANA_HORAS = 24;
  private static readonly LOTE = 40;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ia: IaVentasService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  @Cron('*/30 * * * *', { name: 'leads-seguimiento' })
  async ejecutar(): Promise<void> {
    if (!this.ia.disponible()) return;

    const ahora = Date.now();
    const limiteSilencio = new Date(
      ahora - LeadsSeguimientoService.MIN_SILENCIO_HORAS * 3600_000,
    );
    const limiteVentana = new Date(
      ahora - LeadsSeguimientoService.VENTANA_HORAS * 3600_000,
    );

    // Candidatas: activas, sin seguimiento aún, con silencio >= MIN y dentro de
    // la ventana de 24h (proxy por actualizadoEn), IA + seguimiento activos, bot
    // no pausado y número conectado.
    const candidatas = await this.prisma.leadConversacion.findMany({
      where: {
        estado: 'ACTIVA' as any,
        seguimientos: 0,
        actualizadoEn: { lte: limiteSilencio, gte: limiteVentana },
        prospecto: { is: { botActivo: true } },
        empresa: {
          is: {
            iaVentasActiva: true,
            iaVentasSeguimiento: true,
            whatsappActivo: true,
          },
        },
      },
      select: {
        id: true,
        telefonoProspecto: true,
        empresa: {
          select: {
            id: true,
            razonSocial: true,
            nombreComercial: true,
            iaVentasContexto: true,
            rubro: { select: { nombre: true } },
          },
        },
      },
      take: LeadsSeguimientoService.LOTE,
      orderBy: { actualizadoEn: 'asc' },
    });

    if (candidatas.length === 0) return;
    let enviados = 0;

    for (const conv of candidatas) {
      try {
        // Últimos mensajes (para verificar estado y armar contexto).
        const mensajes = await this.prisma.leadMensaje.findMany({
          where: { conversacionId: conv.id },
          orderBy: { id: 'desc' },
          take: 12,
          select: { rol: true, contenido: true, creadoEn: true },
        });
        if (mensajes.length === 0) continue;

        // El último mensaje debe ser del ASISTENTE (el prospecto no respondió).
        if (mensajes[0].rol !== 'ASISTENTE') continue;

        // Confirmar ventana de 24h contra el ÚLTIMO mensaje del PROSPECTO.
        const ultimoUsuario = mensajes.find((m) => m.rol === 'USUARIO');
        if (
          !ultimoUsuario ||
          ahora - new Date(ultimoUsuario.creadoEn).getTime() >=
            LeadsSeguimientoService.VENTANA_HORAS * 3600_000
        ) {
          continue;
        }

        const historial: MensajeConversacion[] = mensajes
          .slice()
          .reverse()
          .map((m) => ({
            role: m.rol === 'USUARIO' ? 'user' : 'assistant',
            content: m.contenido,
          }));

        const emp = conv.empresa;
        const partes: string[] = [
          `Negocio: ${emp.nombreComercial || emp.razonSocial}${
            emp.rubro ? ` (rubro: ${emp.rubro.nombre})` : ''
          }.`,
        ];
        if (emp.iaVentasContexto) partes.push(emp.iaVentasContexto);
        const businessContext = partes.join('\n');

        const texto = await this.ia.generarSeguimiento(historial, businessContext);
        if (!texto) continue;

        await this.prisma.leadMensaje.create({
          data: {
            conversacionId: conv.id,
            rol: 'ASISTENTE',
            contenido: texto,
          },
        });
        const envio = await this.whatsapp.enviarTexto(
          conv.telefonoProspecto,
          texto,
          emp.id,
        );
        if (!envio.success) {
          this.logger.warn(
            `Seguimiento: envío falló a ${conv.telefonoProspecto}: ${envio.error}`,
          );
        }
        await this.prisma.leadConversacion.update({
          where: { id: conv.id },
          data: { seguimientos: { increment: 1 }, ultimoSeguimientoEn: new Date() },
        });
        enviados++;
      } catch (e: any) {
        this.logger.warn(
          `Seguimiento: error en conversación ${conv.id}: ${e?.message}`,
        );
      }
    }

    if (enviados > 0) {
      this.logger.log(`Seguimiento automático: ${enviados} reenganche(s) enviados.`);
    }
  }
}
