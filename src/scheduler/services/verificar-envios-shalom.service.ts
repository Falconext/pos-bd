import { Injectable, Logger } from '@nestjs/common';
import { EstadoDespacho } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ShalomService } from '../../shalom/shalom.service';
import { NotificacionesService } from '../../notificaciones/notificaciones.service';
import { EnvioDespachoService } from '../../envio-despacho/envio-despacho.service';
import { etiquetaEtapaShalom, ShalomEstado } from '../../shalom/shalom.util';

// Couriers Shalom que se rastrean automáticamente.
const SHALOM_COURIERS = ['SHALOM_PRO', 'SHALOM_COD'];
// Máximo de envíos por corrida: el scraper de Shalom es frágil, no conviene
// dispararle decenas de consultas de golpe.
const MAX_POR_CORRIDA = 40;
// Pausa entre consultas para no saturar el upstream.
const PAUSA_ENTRE_MS = 350;

// Mapa etapa Shalom → estado del despacho en el panel. `registrado` es demasiado
// temprano (aún no se movió el paquete) → no cambia el panel.
const ETAPA_A_DESPACHO: Record<ShalomEstado, EstadoDespacho | null> = {
  registrado: null,
  origen: EstadoDespacho.EN_CAMINO,
  transito: EstadoDespacho.EN_CAMINO,
  destino: EstadoDespacho.EN_AGENCIA,
  entregado: EstadoDespacho.ENTREGADO,
};

// Orden de avance: solo se actualiza el panel HACIA ADELANTE (nunca se retrocede
// un estado puesto a mano, ni se toca un DEVUELTO).
const RANK_DESPACHO: Record<string, number> = {
  [EstadoDespacho.PREPARANDO]: 0,
  [EstadoDespacho.EN_CAMINO]: 1,
  [EstadoDespacho.EN_AGENCIA]: 2,
  [EstadoDespacho.EN_DESTINO]: 2,
  [EstadoDespacho.ENTREGADO]: 3,
  [EstadoDespacho.DEVUELTO]: 99, // no auto-cambiar un devuelto
};

@Injectable()
export class VerificarEnviosShalomService {
  private readonly logger = new Logger(VerificarEnviosShalomService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shalom: ShalomService,
    private readonly notificaciones: NotificacionesService,
    private readonly envioDespacho: EnvioDespachoService,
  ) {}

  /**
   * Recorre los envíos Shalom NO entregados, refresca su tracking y — cuando el
   * paquete avanza de etapa — actualiza automáticamente el estado del despacho en
   * el panel (EN_CAMINO / EN_AGENCIA / ENTREGADO). Reusa `EnvioDespachoService.update`
   * para heredar el mismo comportamiento del cambio manual: historial, aviso por
   * WhatsApp al cliente y sincronización con el pedido de tienda. Corre cada ~30 min.
   */
  async execute(): Promise<void> {
    const envios = await this.prisma.envioDespacho.findMany({
      where: {
        transportista: { in: SHALOM_COURIERS },
        shalomEntregado: false,
        nroOrden: { not: null },
        claveOrden: { not: null },
      },
      take: MAX_POR_CORRIDA,
      // Los nunca sincronizados (null) primero, luego los más antiguos.
      orderBy: { shalomSyncAt: { sort: 'asc', nulls: 'first' } },
      select: {
        id: true,
        nroOrden: true,
        claveOrden: true,
        estado: true,
        agenciaDestino: true,
        comprobante: {
          select: { id: true, serie: true, correlativo: true, empresaId: true },
        },
      },
    });

    if (!envios.length) return;
    this.logger.log(`[Shalom] Verificando ${envios.length} envío(s) en curso…`);

    let cambios = 0;
    for (const envio of envios) {
      try {
        // 1) Refresca los campos shalom* (para la caché del modal de tracking).
        const { derivado } = await this.shalom.sincronizarEnvio(
          envio.id,
          envio.nroOrden!,
          envio.claveOrden!,
          envio.comprobante?.empresaId,
        );
        if (!derivado.estado || !envio.comprobante) continue;

        // 2) ¿El nuevo estado Shalom implica avanzar el estado del panel?
        const destino = ETAPA_A_DESPACHO[derivado.estado];
        if (!destino) continue;
        const rankActual = RANK_DESPACHO[envio.estado] ?? 0;
        const rankNuevo = RANK_DESPACHO[destino] ?? 0;
        if (rankNuevo <= rankActual) continue; // no retroceder ni repetir

        // 3) Actualiza el despacho como lo haría el botón manual (WA + tienda + historial).
        // No se pasa `observaciones`: es un campo persistente y lo sobrescribiría
        // (borraría las notas del usuario). El cambio queda en el historial.
        await this.envioDespacho.update(
          envio.comprobante.id,
          envio.comprobante.empresaId,
          { estado: destino as any } as any,
        );
        cambios++;
        await this.notificarAdmins(envio, destino, derivado.estado);
      } catch (err: any) {
        this.logger.warn(
          `[Shalom] Envío ${envio.id} (orden ${envio.nroOrden}) no se pudo actualizar: ${err?.message}`,
        );
      }
      await new Promise((r) => setTimeout(r, PAUSA_ENTRE_MS));
    }

    if (cambios)
      this.logger.log(`[Shalom] ${cambios} pedido(s) actualizados automáticamente.`);
  }

  /** Notificación in-app a los admins de la empresa cuando el pedido avanza. */
  private async notificarAdmins(
    envio: {
      id: number;
      agenciaDestino: string | null;
      comprobante: { serie: string; correlativo: number; empresaId: number } | null;
    },
    destino: EstadoDespacho,
    etapa: ShalomEstado,
  ): Promise<void> {
    const comp = envio.comprobante;
    if (!comp) return;
    const pedidoRef = `${comp.serie}-${String(comp.correlativo).padStart(8, '0')}`;
    const entregado = destino === EstadoDespacho.ENTREGADO;
    try {
      await this.notificaciones.notificarAdminsEmpresa({
        empresaId: comp.empresaId,
        tipo: 'INFO',
        titulo: entregado
          ? `Pedido entregado · ${pedidoRef}`
          : `Envío Shalom: ${etiquetaEtapaShalom(etapa)} · ${pedidoRef}`,
        mensaje: entregado
          ? `El pedido ${pedidoRef} fue entregado por Shalom y se marcó como ENTREGADO automáticamente.`
          : `El pedido ${pedidoRef} avanzó a "${etiquetaEtapaShalom(etapa)}"${
              envio.agenciaDestino ? ` (${envio.agenciaDestino})` : ''
            }. Se actualizó el panel automáticamente.`,
        metaData: {
          modulo: 'shalom-tracking',
          envioDespachoId: envio.id,
          estadoDespacho: destino,
          etapaShalom: etapa,
        },
      });
    } catch (e: any) {
      this.logger.warn(`[Shalom] Notif in-app envío ${envio.id}: ${e?.message}`);
    }
  }
}
