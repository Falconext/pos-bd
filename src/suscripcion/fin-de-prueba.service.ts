import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { ComprobanteService } from '../comprobante/comprobante.service';
import { QpseClient } from '../common/utils/qpse.client';
import { mensajeQpse, pasarRucAProduccion } from '../common/utils/qpse-cuenta';

/** Comprobantes que van a SUNAT. Las notas primero: apuntan a sus boletas y facturas. */
const TIPOS_SUNAT_EN_ORDEN = [['07', '08'], ['01', '03']];

export type ResultadoFinDePrueba =
  | { paso: false }
  | { paso: true; comprobantesBorrados: number; noBorrados: number; facturacionLista: boolean; motivo?: string };

/**
 * El primer pago de quien se registró con la prueba gratis: de demo a producción.
 *
 * Mientras dura la prueba la empresa factura en el ambiente demo de QPSE. Al
 * confirmarse el pago:
 *  1. Se borran las boletas, facturas y notas de prueba (sin valor ante SUNAT).
 *     `eliminarComprobante` devuelve su stock y limpia el kardex, y como el
 *     correlativo sale del último comprobante de la serie, la numeración real
 *     empieza en 1. Las notas de venta se quedan: no van a SUNAT.
 *     (El "Pasar a producción" del panel borra todo, notas de venta incluidas,
 *     y reinicia las fechas: sirve para una demo del equipo, no para un pago
 *     que ya extiende la suscripción.)
 *  2. El RUC pasa a producción en QPSE (irreversible allá) y se guardan las
 *     credenciales de producción.
 *  3. La empresa deja el modo demo, que es además lo que la mete al ciclo de
 *     cobros para que el pago tenga su mensualidad.
 *
 * Si QPSE no responde, la empresa igual sale de demo (el pago no se pierde),
 * sin credenciales: emitir dice claro que falta configurarlas, y el equipo lo
 * termina desde la consola con el aviso que le llega.
 */
@Injectable()
export class FinDePruebaService {
  private readonly logger = new Logger(FinDePruebaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificaciones: NotificacionesService,
    @Inject(forwardRef(() => ComprobanteService))
    private readonly comprobantes: ComprobanteService,
    @Inject(forwardRef(() => QpseClient))
    private readonly qpse: QpseClient,
  ) {}

  async pasarAProduccion(empresaId: number): Promise<ResultadoFinDePrueba> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, ruc: true, razonSocial: true, usaDemo: true, brand: true },
    });
    if (!empresa?.usaDemo) return { paso: false };
    // Solo las que nacieron en el autoregistro: una demo armada por el equipo
    // se pasa a mano, con su propio criterio.
    const delRegistro = await this.prisma.empresaLog.findFirst({
      where: { empresaId, accion: 'REGISTRO_PRUEBA' },
      select: { id: true },
    });
    if (!delRegistro) return { paso: false };

    let comprobantesBorrados = 0;
    let noBorrados = 0;
    for (const tipos of TIPOS_SUNAT_EN_ORDEN) {
      const demo = await this.prisma.comprobante.findMany({
        where: { empresaId, tipoDoc: { in: tipos } },
        select: { id: true },
        orderBy: { id: 'desc' },
      });
      for (const { id } of demo) {
        try {
          await this.comprobantes.eliminarComprobante(id);
          comprobantesBorrados += 1;
        } catch (e: any) {
          noBorrados += 1;
          this.logger.warn(`Fin de prueba ${empresaId}: no se pudo borrar el comprobante ${id}: ${e?.message}`);
        }
      }
    }

    if (comprobantesBorrados && !noBorrados) {
      await this.prisma.empresaSerie.updateMany({
        where: { empresaId, tipoDoc: { in: TIPOS_SUNAT_EN_ORDEN.flat() } },
        data: { correlativo: 1 },
      });
    }

    let qpse: { ok: true; usuario: string; clave: string } | { ok: false; motivo: string };
    try {
      const fila = await pasarRucAProduccion(this.qpse, empresa.ruc);
      qpse = { ok: true, usuario: fila.username, clave: fila.password };
    } catch (err) {
      qpse = { ok: false, motivo: mensajeQpse(err) };
    }
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: qpse.ok
        ? {
            usaDemo: false,
            usuarioPse: qpse.usuario,
            contrasenaPse: qpse.clave,
            // QPSE tarda ~24 h en terminar el alta ante SUNAT (habilitacion.ts).
            apiEmisorEstado: 'pendiente',
            apiEmisorDesde: new Date(),
            apiEmisorMotivo: null,
          }
        : // Las credenciales demo no sirven en producción: mejor el error claro de "faltan".
          { usaDemo: false, usuarioPse: null, contrasenaPse: null },
    });

    const autor = await this.prisma.usuario.findFirst({
      where: { empresaId, rol: 'ADMIN_EMPRESA' },
      select: { nombre: true, email: true },
      orderBy: { id: 'asc' },
    });
    const detalle =
      `Fin de la prueba por pago: ${comprobantesBorrados} comprobantes de prueba borrados` +
      (noBorrados ? `, ${noBorrados} no se pudieron borrar` : '') +
      (qpse.ok ? '. RUC en producción en QPSE.' : `. Falta pasar a producción: ${qpse.motivo}`);
    await this.prisma.empresaLog.create({
      data: {
        empresaId,
        accion: qpse.ok ? 'QPSE_PRODUCCION' : 'QPSE_PRODUCCION_PENDIENTE',
        detalle,
        autorNombre: autor?.nombre ?? 'Sistema',
        autorEmail: autor?.email ?? 'sistema',
      },
    });

    await this.avisar(empresa, qpse.ok, detalle);
    this.logger.log(`Empresa ${empresaId}: ${detalle}`);
    return {
      paso: true,
      comprobantesBorrados,
      noBorrados,
      facturacionLista: qpse.ok,
      ...(qpse.ok ? {} : { motivo: qpse.motivo }),
    };
  }

  /** Al cliente, qué cambió; al equipo, solo si hay algo que terminar a mano. */
  private async avisar(
    empresa: { id: number; ruc: string; razonSocial: string; brand: string | null },
    facturacionLista: boolean,
    detalle: string,
  ) {
    try {
      const admins = await this.prisma.usuario.findMany({
        where: { empresaId: empresa.id, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
        select: { id: true },
      });
      for (const admin of admins) {
        await this.notificaciones.crearNotificacion({
          usuarioId: admin.id,
          empresaId: empresa.id,
          tipo: 'INFO',
          titulo: facturacionLista ? 'Tu facturación real ya está activa' : 'Estamos activando tu facturación real',
          mensaje: facturacionLista
            ? 'Gracias por tu pago. Borramos tus boletas y facturas de prueba y la numeración empieza en 1. SUNAT puede tardar hasta 24 horas en terminar tu alta: si una boleta sale rechazada en ese tiempo, vuelve a intentarlo más tarde.'
            : 'Gracias por tu pago. Borramos tus boletas y facturas de prueba y estamos terminando de activar tu facturación real; te avisamos apenas esté lista. Mientras tanto puedes emitir notas de venta.',
        });
      }
      if (facturacionLista) return;
      const equipo = await this.prisma.usuario.findMany({
        where: {
          rol: 'ADMIN_SISTEMA',
          estado: 'ACTIVO',
          OR: [{ sistemaNegocio: empresa.brand ?? 'krezka' }, { sistemaNegocio: null }],
        },
        select: { id: true },
      });
      for (const u of equipo) {
        await this.notificaciones.crearNotificacion({
          usuarioId: u.id,
          empresaId: empresa.id,
          tipo: 'WARNING',
          titulo: 'Pasar a producción a mano',
          mensaje: `${empresa.razonSocial} (RUC ${empresa.ruc}) pagó su plan. ${detalle} Termínalo desde la consola de facturación.`,
        });
      }
    } catch (e: any) {
      // El pago y la facturación ya se resolvieron; un aviso que no sale no los deshace.
      this.logger.warn(`No se pudo avisar el fin de prueba de ${empresa.id}: ${e?.message}`);
    }
  }
}
