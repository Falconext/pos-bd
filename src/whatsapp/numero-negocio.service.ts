import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CredencialesTakiy, enviarTakiy } from './takiy';
import {
  EvolutionEnvioService,
  MensajeNegocio,
} from './evolution-envio.service';

export type ViaNumeroNegocio = 'EVOLUTION' | 'TAKIY';

export interface ResultadoNumeroNegocio {
  success: boolean;
  error?: string;
  /** Por dónde salió (o el último que se intentó); null si no hay ninguno. */
  via: ViaNumeroNegocio | null;
}

/**
 * "Enviar desde el número del negocio": un solo lugar para los mensajes que
 * salen del WhatsApp propio del negocio vinculado por QR (texto libre, sin
 * plantillas ni costo por mensaje).
 *
 * Orden: Evolution conectado → Takiy activo. Si ninguno está, `via: null` y
 * el llamador sigue con lo de siempre (Meta si el plan lo permite, o nada).
 * Si Evolution falla sin ambigüedad (cola llena, tope diario, sesión caída,
 * error claro) se intenta Takiy; con un timeout no, para no duplicarle el
 * mensaje al cliente.
 */
@Injectable()
export class NumeroNegocioService {
  private readonly logger = new Logger(NumeroNegocioService.name);
  enviarTakiyImpl = enviarTakiy;

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionEnvioService,
  ) {}

  /** ¿Hay un número del negocio por QR listo (Evolution conectado o Takiy activo)? */
  async proveedorActivo(empresaId: number): Promise<ViaNumeroNegocio | null> {
    if (await this.evolution.conectado(empresaId)) return 'EVOLUTION';
    if (await this.credencialesTakiy(empresaId)) return 'TAKIY';
    return null;
  }

  async disponible(empresaId: number): Promise<boolean> {
    return (await this.proveedorActivo(empresaId)) !== null;
  }

  async enviar(
    empresaId: number,
    m: MensajeNegocio,
  ): Promise<ResultadoNumeroNegocio> {
    let ultimo: ResultadoNumeroNegocio = {
      success: false,
      via: null,
      error: 'El negocio no tiene su WhatsApp conectado por QR.',
    };

    if (await this.evolution.conectado(empresaId)) {
      const r = await this.evolution.enviar(empresaId, m);
      if (r.success) return { success: true, via: 'EVOLUTION' };
      ultimo = { success: false, via: 'EVOLUTION', error: r.error };
      if (r.ambiguo) return ultimo;
      this.logger.warn(
        `Evolution empresa ${empresaId} no envió (${r.motivo}); se intenta Takiy.`,
      );
    }

    const cred = await this.credencialesTakiy(empresaId);
    if (cred) {
      const t = await this.enviarTakiyImpl(cred, {
        numero: m.numero,
        mensaje: m.mensaje,
        archivoUrl: m.archivoUrl,
      });
      if (t.success) return { success: true, via: 'TAKIY' };
      this.logger.warn(`Takiy empresa ${empresaId} a ${m.numero}: ${t.error}`);
      return { success: false, via: 'TAKIY', error: t.error };
    }
    return ultimo;
  }

  private async credencialesTakiy(
    empresaId: number,
  ): Promise<CredencialesTakiy | null> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { takiyActivo: true, takiyAppKey: true, takiyAuthKey: true },
    });
    if (!e?.takiyActivo || !e.takiyAppKey || !e.takiyAuthKey) return null;
    return { appKey: e.takiyAppKey, authKey: e.takiyAuthKey };
  }
}

/** Texto para el negocio cuando el envío por su número falla. */
export function consejoNumeroNegocio(via: ViaNumeroNegocio | null): string {
  if (via === 'TAKIY') return 'Revisa en Takiy que tu celular siga vinculado.';
  return 'Revisa en Configuración → WhatsApp que tu celular siga vinculado.';
}
