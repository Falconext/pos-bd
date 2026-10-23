import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { IaVentasService, MensajeConversacion } from './leads-ia.service';
import {
  CONFIG_DISPARADORES_DEFECTO,
  TipoDisparo,
  enHorarioHabil,
  postergaLaCompra,
} from './leads-disparadores';
import { HERRAMIENTA_DAR_DEMO } from './leads-herramientas';
import { enFormatoWhatsapp } from './formato-whatsapp';
import { perfilValido } from './perfil-vendedor';

/**
 * Avisos que ya le van a escribir al cliente cuando él dijo. Con uno de estos
 * programado, el reenganche de la hora no sale: el cliente pidió tiempo.
 */
export const DISPAROS_QUE_ESPERAN_AL_CLIENTE: TipoDisparo[] = [
  // "Te aviso luego": se le escribe a la mañana siguiente.
  TipoDisparo.CARRITO_EN_ESPERA,
  // "El viernes te confirmo": se le escribe ese día.
  TipoDisparo.RECORDATORIO_ACORDADO,
];

/**
 * Por qué NO toca el reenganche de la hora, o `null` si toca. Las excepciones
 * las fijó Hierba Sana (20-10): el cliente que ya agendó no necesita que le
 * pregunten si sigue, y al que dijo que avisaba o que escribía después se le
 * escribe al día siguiente, no a la hora.
 *
 * Una despedida ("gracias por la info") NO es excepción: es justo el
 * cliente que el reenganche puede recuperar.
 */
export function motivoParaNoReenganchar(s: {
  pedidoAgendado: boolean;
  esperaAvisoProgramado: boolean;
  ultimoDelCliente: string;
  /** Herramientas del último mensaje del asistente. */
  herramientasDelUltimo?: unknown;
}): string | null {
  if (s.pedidoAgendado) return 'ya agendó su pedido';
  // Krezka: al entregar la demo se le dice que tiene 3 horas para revisarla.
  // Escribirle a la hora lo contradice; la demo tiene su propio seguimiento.
  const llamadas = Array.isArray(s.herramientasDelUltimo) ? s.herramientasDelUltimo : [];
  if (llamadas.some((ll: any) => ll?.nombre === HERRAMIENTA_DAR_DEMO && ll?.resultado?.acceso))
    return 'se le acaba de dar la demo';
  if (s.esperaAvisoProgramado) return 'tiene un aviso programado para cuando dijo';
  if (postergaLaCompra(s.ultimoDelCliente)) return 'dijo que avisaba o que escribía después';
  return null;
}

/**
 * Seguimiento automático de la IA de Ventas.
 *
 * Cada 10 min busca conversaciones donde el prospecto dejó de responder (el
 * último mensaje es del ASISTENTE) y, si pasó una hora de silencio pero seguimos
 * DENTRO de la ventana de 24h de WhatsApp (mensaje libre, sin costo de
 * plantilla), envía UN reenganche generado por la IA. Máximo un seguimiento por
 * silencio: `seguimientos` se reinicia a 0 cuando el prospecto vuelve a escribir
 * (en el processor), así que aquí solo actuamos cuando está en 0.
 */
@Injectable()
export class LeadsSeguimientoService {
  private readonly logger = new Logger(LeadsSeguimientoService.name);

  // Silencio mínimo antes de reenganchar, y ventana libre de WhatsApp.
  // Una hora y no cuatro (Hierba Sana, 20-10): a las cuatro se cruzaba con el
  // aviso de cotización sin cerrar, que sale a las tres.
  private static readonly MIN_SILENCIO_HORAS = 1;
  private static readonly VENTANA_HORAS = 24;
  private static readonly LOTE = 40;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ia: IaVentasService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  // Cada 10 minutos: con media hora, "a la hora" llegaba a ser hora y media.
  @Cron('*/10 * * * *', { name: 'leads-seguimiento' })
  async ejecutar(): Promise<void> {
    if (!this.ia.disponible()) return;
    // Solo en horario de atención (9 a. m. a 9 p. m. de Lima, el mismo de
    // los avisos automáticos). Antes salía a cualquier hora: un reenganche a
    // las 2 de la mañana. Lo que tocaba de noche se manda a primera hora si
    // la ventana de 24 h sigue abierta. Pedido de Hierba Sana, 19-10.
    if (!enHorarioHabil(new Date(), CONFIG_DISPARADORES_DEFECTO)) return;

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
        // Activo, o con la pausa ya vencida: si no, una intervención manual
        // dejaba la conversación sin seguimiento para siempre.
        prospecto: {
          is: {
            OR: [
              { botActivo: true },
              { botActivo: false, pausadoHasta: { lte: new Date() } },
            ],
          },
        },
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
            iaVentasConfigJson: true,
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
          select: { rol: true, contenido: true, creadoEn: true, herramientasJson: true },
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

        const [borrador, esperando] = await Promise.all([
          this.prisma.leadPedidoBorrador.findUnique({
            where: { conversacionId: conv.id },
            select: { comprobanteId: true },
          }),
          this.prisma.leadDisparo.count({
            where: {
              empresaId: conv.empresa.id,
              telefono: conv.telefonoProspecto,
              estado: 'PROGRAMADO',
              tipo: { in: DISPAROS_QUE_ESPERAN_AL_CLIENTE as never },
            },
          }),
        ]);
        const motivo = motivoParaNoReenganchar({
          pedidoAgendado: !!borrador?.comprobanteId,
          esperaAvisoProgramado: esperando > 0,
          ultimoDelCliente: ultimoUsuario.contenido,
          herramientasDelUltimo: mensajes[0].herramientasJson,
        });
        if (motivo) {
          // Se marca como atendido para no volver a evaluarlo cada 10 min. Si
          // el cliente escribe, el contador vuelve a 0 y todo arranca de nuevo.
          await this.prisma.leadConversacion.update({
            where: { id: conv.id },
            data: { seguimientos: { increment: 1 } },
          });
          this.logger.log(`Seguimiento: conv ${conv.id} sin reenganche (${motivo}).`);
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

        // El seguimiento también habla como el vendedor que configuró el
        // dueño: con su nombre, su tono y sin sus palabras prohibidas.
        const cfg = (emp.iaVentasConfigJson ?? {}) as {
          asesor?: string;
          vendedor?: unknown;
        };
        const texto = await this.ia.generarSeguimiento(
          historial,
          businessContext,
          {
            nombre: emp.nombreComercial || emp.razonSocial,
            rubro: emp.rubro?.nombre ?? null,
            asesor: cfg.asesor ?? null,
            perfil: cfg.vendedor ? perfilValido(cfg.vendedor) : null,
            contexto: businessContext,
          },
        );
        if (!texto) continue;
        const textoWhatsapp = enFormatoWhatsapp(texto);

        await this.prisma.leadMensaje.create({
          data: {
            conversacionId: conv.id,
            rol: 'ASISTENTE',
            contenido: textoWhatsapp,
          },
        });
        const envio = await this.whatsapp.enviarTexto(
          conv.telefonoProspecto,
          textoWhatsapp,
          emp.id,
        );
        if (!envio.success) {
          this.logger.warn(
            `Seguimiento: envío falló a ${conv.telefonoProspecto}: ${envio.error}`,
          );
        }
        await this.prisma.leadConversacion.update({
          where: { id: conv.id },
          data: {
            seguimientos: { increment: 1 },
            ultimoSeguimientoEn: new Date(),
          },
        });
        enviados++;
      } catch (e: any) {
        this.logger.warn(
          `Seguimiento: error en conversación ${conv.id}: ${e?.message}`,
        );
      }
    }

    if (enviados > 0) {
      this.logger.log(
        `Seguimiento automático: ${enviados} reenganche(s) enviados.`,
      );
    }
  }
}
