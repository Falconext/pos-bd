import { Injectable, Logger } from '@nestjs/common';
import { EstadoDespacho } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OlvaService } from '../../olva/olva.service';
import { NotificacionesService } from '../../notificaciones/notificaciones.service';
import { EnvioDespachoService } from '../../envio-despacho/envio-despacho.service';
import { etiquetaEtapaOlva, OlvaEstado } from '../../olva/olva.util';

// Courier Olva que se rastrea automáticamente.
const OLVA_COURIERS = ['OLVA'];
// Máximo de envíos por corrida. Olva expone `/tracking/bulk` (50 por llamada),
// pero se consulta de a uno para poder persistir y avanzar cada despacho por
// separado sin que un fallo individual aborte el resto.
const MAX_POR_CORRIDA = 40;
// Pausa entre consultas para no saturar el upstream.
const PAUSA_ENTRE_MS = 350;

// Mapa etapa Olva → estado del despacho en el panel. `registrado` es demasiado
// temprano (aún no se movió el paquete) → no cambia el panel.
const ETAPA_A_DESPACHO: Record<OlvaEstado, EstadoDespacho | null> = {
  registrado: null,
  transito: EstadoDespacho.EN_CAMINO,
  reparto: EstadoDespacho.EN_CAMINO,
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
export class VerificarEnviosOlvaService {
  private readonly logger = new Logger(VerificarEnviosOlvaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly olva: OlvaService,
    private readonly notificaciones: NotificacionesService,
    private readonly envioDespacho: EnvioDespachoService,
  ) {}

  /**
   * Recorre los envíos Olva NO entregados, refresca su tracking y — cuando el
   * paquete avanza de etapa — actualiza automáticamente el estado del despacho en
   * el panel (EN_CAMINO / EN_AGENCIA / ENTREGADO). Reusa `EnvioDespachoService.update`
   * para heredar el mismo comportamiento del cambio manual: historial, aviso por
   * WhatsApp al cliente y sincronización con el pedido de tienda. Corre cada ~30 min.
   */
  async execute(): Promise<void> {
    const envios = await this.prisma.envioDespacho.findMany({
      where: {
        transportista: { in: OLVA_COURIERS },
        olvaEntregado: false,
        nroOrden: { not: null },
        // Opt-in por empresa: solo se auto-rastrea (y auto-notifica por WhatsApp)
        // a los clientes de empresas que activaron el rastreo automático.
        comprobante: { empresa: { olvaAutoTrackingActivo: true } },
      },
      take: MAX_POR_CORRIDA,
      // Los nunca sincronizados (null) primero, luego los más antiguos.
      orderBy: { olvaSyncAt: { sort: 'asc', nulls: 'first' } },
      select: {
        id: true,
        nroOrden: true,
        estado: true,
        agenciaDestino: true,
        comprobante: {
          select: { id: true, serie: true, correlativo: true, empresaId: true },
        },
      },
    });

    if (!envios.length) return;
    this.logger.log(`[Olva] Verificando ${envios.length} envío(s) en curso…`);

    let cambios = 0;
    for (const envio of envios) {
      try {
        // 1) Refresca los campos olva* (para la caché del modal de tracking).
        const { derivado } = await this.olva.sincronizarEnvio(
          envio.id,
          envio.nroOrden!,
          envio.comprobante?.empresaId,
        );
        if (!derivado.estado || !envio.comprobante) continue;

        // 2) ¿El nuevo estado Olva implica avanzar el estado del panel?
        const destino = ETAPA_A_DESPACHO[derivado.estado];
        if (!destino) continue;
        const rankActual = RANK_DESPACHO[envio.estado] ?? 0;
        const rankNuevo = RANK_DESPACHO[destino] ?? 0;
        if (rankNuevo <= rankActual) continue; // no retroceder ni repetir

        // 3) Actualiza el despacho como lo haría el botón manual (WA + tienda + historial).
        // No se pasa `observaciones`: es un campo persistente y lo sobrescribiría.
        await this.envioDespacho.update(
          envio.comprobante.id,
          envio.comprobante.empresaId,
          { estado: destino as any } as any,
        );
        cambios++;
        await this.notificarAdmins(envio, destino, derivado.estado);
      } catch (err: any) {
        this.logger.warn(
          `[Olva] Envío ${envio.id} (guía ${envio.nroOrden}) no se pudo actualizar: ${err?.message}`,
        );
      }
      await new Promise((r) => setTimeout(r, PAUSA_ENTRE_MS));
    }

    if (cambios)
      this.logger.log(
        `[Olva] ${cambios} pedido(s) actualizados automáticamente.`,
      );
  }

  /** Notificación in-app a los admins de la empresa cuando el pedido avanza. */
  private async notificarAdmins(
    envio: {
      id: number;
      agenciaDestino: string | null;
      comprobante: {
        serie: string;
        correlativo: number;
        empresaId: number;
      } | null;
    },
    destino: EstadoDespacho,
    etapa: OlvaEstado,
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
          : `Envío Olva: ${etiquetaEtapaOlva(etapa)} · ${pedidoRef}`,
        mensaje: entregado
          ? `El pedido ${pedidoRef} fue entregado por Olva y se marcó como ENTREGADO automáticamente.`
          : `El pedido ${pedidoRef} avanzó a "${etiquetaEtapaOlva(etapa)}"${
              envio.agenciaDestino ? ` (${envio.agenciaDestino})` : ''
            }. Se actualizó el panel automáticamente.`,
        metaData: {
          modulo: 'olva-tracking',
          envioDespachoId: envio.id,
          estadoDespacho: destino,
          etapaOlva: etapa,
        },
      });
    } catch (e: any) {
      this.logger.warn(`[Olva] Notif in-app envío ${envio.id}: ${e?.message}`);
    }
  }
}
