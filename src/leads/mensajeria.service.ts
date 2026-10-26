import { Injectable } from '@nestjs/common';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { InstagramService } from '../instagram/instagram.service';
import { esDestinoInstagram } from '../instagram/instagram-texto';
import { MessengerService } from '../messenger/messenger.service';
import { esDestinoMessenger } from '../messenger/messenger-texto';

type Resultado = { success: boolean; error?: string };

/**
 * Por dónde sale cada mensaje de la IA de Ventas.
 *
 * La IA nació solo para WhatsApp y llamaba a `WhatsAppService` en ~15 lugares.
 * En vez de tocar cada uno, este servicio tiene los mismos métodos y decide
 * por el destino: `ig:<id>` sale por Instagram, `fb:<id>` por Messenger y todo
 * lo demás (un teléfono o un id @nick de WhatsApp) sigue por WhatsApp
 * exactamente como antes.
 *
 * Lo que Instagram y Messenger no tienen se resuelve acá y no en cada llamada:
 *  - Plantillas: no existen. Fuera de las 24 h no se le puede escribir, así
 *    que se responde `success:false` y quien llama lo trata como un envío que
 *    no salió (igual que una plantilla rechazada).
 *  - Documentos: va el enlace como texto.
 *  - Notas de voz desde el panel: se necesitaría la URL pública del audio; por
 *    ahora se avisa que no se puede, en vez de fallar en silencio.
 */
@Injectable()
export class MensajeriaService {
  constructor(
    private readonly wa: WhatsAppService,
    private readonly ig: InstagramService,
    private readonly fb: MessengerService,
  ) {}

  enviarTexto(numero: string, mensaje: string, empresaId?: number): Promise<Resultado> {
    if (esDestinoInstagram(numero)) return this.ig.enviarTexto(numero, mensaje, empresaId!);
    if (esDestinoMessenger(numero)) return this.fb.enviarTexto(numero, mensaje, empresaId!);
    return this.wa.enviarTexto(numero, mensaje, empresaId);
  }

  enviarImagenUrl(numero: string, imagenUrl: string, caption: string | undefined, empresaId?: number): Promise<Resultado> {
    if (esDestinoInstagram(numero)) return this.ig.enviarAdjunto(numero, 'image', imagenUrl, caption, empresaId!);
    if (esDestinoMessenger(numero)) return this.fb.enviarAdjunto(numero, 'image', imagenUrl, caption, empresaId!);
    return this.wa.enviarImagenUrl(numero, imagenUrl, caption, empresaId);
  }

  enviarVideoUrl(numero: string, videoUrl: string, caption?: string, empresaId?: number): Promise<Resultado> {
    if (esDestinoInstagram(numero)) return this.ig.enviarAdjunto(numero, 'video', videoUrl, caption, empresaId!);
    if (esDestinoMessenger(numero)) return this.fb.enviarAdjunto(numero, 'video', videoUrl, caption, empresaId!);
    return this.wa.enviarVideoUrl(numero, videoUrl, caption, empresaId);
  }

  enviarDocumentoUrl(
    numero: string,
    pdfUrl: string,
    filename: string,
    caption?: string,
    empresaId?: number,
  ): Promise<Resultado> {
    if (esDestinoInstagram(numero)) {
      const texto = [caption?.trim(), `${filename}: ${pdfUrl}`].filter(Boolean).join('\n\n');
      return this.ig.enviarTexto(numero, texto, empresaId!);
    }
    if (esDestinoMessenger(numero)) return this.fb.enviarAdjunto(numero, 'file', pdfUrl, caption, empresaId!);
    return this.wa.enviarDocumentoUrl(numero, pdfUrl, filename, caption, empresaId);
  }

  /** Por Instagram y Messenger no hay mensaje de ubicación: va el enlace de Google Maps. */
  enviarUbicacion(
    numero: string,
    ubicacion: { lat: number; lng: number; nombre?: string; direccion?: string },
    empresaId?: number,
  ): Promise<Resultado> {
    if (esDestinoInstagram(numero) || esDestinoMessenger(numero)) {
      const texto = [
        ubicacion.nombre,
        ubicacion.direccion,
        `https://www.google.com/maps?q=${ubicacion.lat},${ubicacion.lng}`,
      ]
        .filter(Boolean)
        .join('\n');
      return this.enviarTexto(numero, texto, empresaId);
    }
    return this.wa.enviarUbicacion(numero, ubicacion, empresaId);
  }

  async enviarAudio(numero: string, ogg: Buffer, empresaId?: number): Promise<Resultado> {
    if (esDestinoInstagram(numero)) {
      return { success: false, error: 'Por Instagram todavía no se pueden mandar notas de voz desde el panel: escríbele un mensaje.' };
    }
    if (esDestinoMessenger(numero)) {
      return { success: false, error: 'Por Messenger todavía no se pueden mandar notas de voz desde el panel: escríbele un mensaje.' };
    }
    return this.wa.enviarAudio(numero, ogg, empresaId);
  }

  async enviarPlantilla(
    numero: string,
    plantilla: string,
    idioma: string,
    parametros: string[],
    empresaId?: number,
  ): Promise<{ success: boolean; mensajeId?: string; error?: string }> {
    if (esDestinoInstagram(numero)) {
      return { success: false, error: 'Instagram no tiene plantillas: pasadas las 24 h solo se le puede escribir si el cliente vuelve a escribir.' };
    }
    if (esDestinoMessenger(numero)) {
      return { success: false, error: 'Messenger no tiene plantillas: pasadas las 24 h solo se le puede escribir si el cliente vuelve a escribir.' };
    }
    return this.wa.enviarPlantilla(numero, plantilla, idioma, parametros, empresaId);
  }

  /** Nombre y @usuario de un cliente de Instagram (vacío si no se puede). */
  perfilInstagram(destino: string, empresaId: number) {
    return this.ig.perfil(destino, empresaId);
  }

  /** Nombre de un cliente de Messenger (vacío si no se puede). */
  perfilMessenger(destino: string, empresaId: number) {
    return this.fb.perfil(destino, empresaId);
  }

  /** En WhatsApp llega un id de media; en Instagram y Messenger, la URL del adjunto. */
  descargarMedia(mediaId: string, empresaId: number): Promise<{ buffer: Buffer; mimeType: string }> {
    if (/^https?:\/\//i.test(String(mediaId))) return this.ig.descargarAdjunto(mediaId);
    return this.wa.descargarMedia(mediaId, empresaId);
  }
}
