import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MensajeMenu } from './menu-inicial';

type Resultado = { success: boolean; error?: string };

/**
 * Salida del chat de la tienda: `MensajeriaService` llama aquí cuando el
 * destino es `web:<sesión>`, y lo "enviado" queda en LeadWebSalida para que
 * el chat de la tienda lo muestre (ver chat-web.ts).
 */
@Injectable()
export class ChatWebSalidaService {
  constructor(private readonly prisma: PrismaService) {}

  private async conversacionDe(destino: string, empresaId?: number) {
    return this.prisma.leadConversacion.findFirst({
      where: { telefonoProspecto: destino, ...(empresaId ? { empresaId } : {}) },
      select: { id: true, empresaId: true },
    });
  }

  async registrar(
    destino: string,
    empresaId: number | undefined,
    salida: { tipo: string; texto?: string | null; url?: string | null; productoId?: number | null; opciones?: MensajeMenu['opciones'] },
  ): Promise<Resultado> {
    const conv = await this.conversacionDe(destino, empresaId);
    if (!conv) return { success: false, error: 'La conversación de la tienda ya no existe.' };
    await this.prisma.leadWebSalida.create({
      data: {
        empresaId: conv.empresaId,
        conversacionId: conv.id,
        tipo: salida.tipo,
        texto: salida.texto ?? null,
        url: salida.url ?? null,
        productoId: salida.productoId ?? null,
        ...(salida.opciones ? { opcionesJson: salida.opciones as never } : {}),
      },
    });
    return { success: true };
  }
}
