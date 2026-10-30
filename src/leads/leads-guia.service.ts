import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MensajeriaService } from './mensajeria.service';
import { LIMITE_TEXTO_WHATSAPP } from './leads.constants';
import { esLineaDeEnvio } from './pedidos-del-cliente';

/**
 * Guía de consumo de cada cliente (30-10).
 *
 * Antes el negocio la escribía a mano en cada venta y no quedaba en ninguna
 * parte. Ahora "cómo se toma" se escribe una vez por producto; con eso y lo
 * que el cliente contó (edad, sexo, síntomas) se arma un borrador. El negocio
 * lo revisa y lo envía: nunca sale solo, porque es tema de salud. Lo enviado
 * queda guardado y la IA lo repite cuando el cliente pregunta.
 */

export interface ProductoDeGuia {
  nombre: string;
  modoDeUso: string | null;
}

/** El borrador, puro para probarlo. Solo lleva lo que escribió el negocio. */
export function borradorDeGuia(
  cliente: { nombre?: string | null; edad?: number | null; sexo?: string | null; sintomas?: string | null },
  productos: ProductoDeGuia[],
): { texto: string; sinModoDeUso: string[] } {
  const conModo = productos.filter((p) => p.modoDeUso?.trim());
  const sinModoDeUso = productos.filter((p) => !p.modoDeUso?.trim()).map((p) => p.nombre);
  if (!conModo.length) return { texto: '', sinModoDeUso };

  const nombre = cliente.nombre?.trim().split(/\s+/)[0];
  const perfil = [
    cliente.sexo === 'F' ? 'mujer' : cliente.sexo === 'M' ? 'hombre' : null,
    cliente.edad ? `${cliente.edad} años` : null,
  ].filter(Boolean);
  const lineas = [
    `*Tu guía de consumo*${nombre ? ` — ${nombre}` : ''} 🌿`,
    ...(perfil.length ? [`Para: ${perfil.join(', ')}`] : []),
    ...(cliente.sintomas?.trim() ? [`Lo que nos contaste: ${cliente.sintomas.trim()}`] : []),
    '',
    ...conModo.flatMap((p) => [`*${p.nombre}*`, p.modoDeUso!.trim(), '']),
  ];
  return { texto: lineas.join('\n').trim(), sinModoDeUso };
}

@Injectable()
export class LeadsGuiaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: MensajeriaService,
  ) {}

  private async conversacion(empresaId: number, conversacionId: number) {
    const conv = await this.prisma.leadConversacion.findFirst({
      where: { id: conversacionId, empresaId },
      select: {
        id: true,
        telefonoProspecto: true,
        nombreProspecto: true,
        prospecto: {
          select: { id: true, nombreProspecto: true, edad: true, sexo: true, sintomas: true, guiaConsumo: true, guiaConsumoEn: true },
        },
      },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    return conv;
  }

  /** Lo último que compró este cliente (o lo que el bot le registró en este chat). */
  private async productosDeLaUltimaCompra(empresaId: number, conversacionId: number, telefono: string) {
    const nueve = /^\+?\d{9,15}$/.test(telefono) ? telefono.replace(/\D/g, '').slice(-9) : null;
    const delBot = await this.prisma.leadPedidoBorrador.findMany({
      where: { empresaId, conversacionId, comprobanteId: { not: null } },
      select: { comprobanteId: true },
    });
    const quien: any[] = [];
    if (delBot.length) quien.push({ id: { in: delBot.map((b) => b.comprobanteId as number) } });
    if (nueve) {
      quien.push({ cliente: { telefono: { endsWith: nueve } } });
      quien.push({ envioDespacho: { celularDest: { endsWith: nueve } } });
    }
    if (!quien.length) return [];
    const venta = await this.prisma.comprobante.findFirst({
      where: {
        empresaId,
        tipoDoc: { in: ['NV', '01', '03', 'TICKET', 'NP'] },
        NOT: [{ estadoPago: 'ANULADO' }, { estadoEnvioSunat: 'ANULADO' }],
        OR: quien,
      },
      orderBy: [{ fechaEmision: 'desc' }, { id: 'desc' }],
      select: {
        detalles: {
          select: {
            descripcion: true,
            producto: { select: { id: true, modoDeUso: true, productoPadre: { select: { modoDeUso: true } } } },
          },
        },
      },
    });
    const vistos = new Set<string>();
    const productos: ProductoDeGuia[] = [];
    for (const d of venta?.detalles ?? []) {
      if (esLineaDeEnvio(d.descripcion) || vistos.has(d.descripcion)) continue;
      vistos.add(d.descripcion);
      // Una variante (talla, presentación) hereda el modo de uso de su producto.
      productos.push({
        nombre: d.descripcion,
        modoDeUso: d.producto?.modoDeUso ?? d.producto?.productoPadre?.modoDeUso ?? null,
      });
    }
    return productos;
  }

  /** La guía guardada y un borrador nuevo con la última compra. */
  async obtener(empresaId: number, conversacionId: number) {
    const conv = await this.conversacion(empresaId, conversacionId);
    const p = conv.prospecto;
    const productos = await this.productosDeLaUltimaCompra(empresaId, conv.id, conv.telefonoProspecto);
    const borrador = borradorDeGuia(
      { nombre: p?.nombreProspecto ?? conv.nombreProspecto, edad: p?.edad, sexo: p?.sexo, sintomas: p?.sintomas },
      productos,
    );
    return {
      guardada: p?.guiaConsumo ? { texto: p.guiaConsumo, en: p.guiaConsumoEn } : null,
      borrador: borrador.texto,
      productos: productos.map((x) => x.nombre),
      sinModoDeUso: borrador.sinModoDeUso,
    };
  }

  /**
   * Guarda la guía (la IA la usa desde el próximo mensaje) y, si se pide, se
   * la manda al cliente. No toma el chat: enviar la guía no es atenderlo a
   * mano, y la IA tiene que poder seguir contestando sus dudas.
   */
  async guardar(empresaId: number, conversacionId: number, texto: string, enviar: boolean) {
    const contenido = String(texto ?? '').trim();
    if (contenido.length > LIMITE_TEXTO_WHATSAPP) {
      throw new BadRequestException(`La guía supera los ${LIMITE_TEXTO_WHATSAPP} caracteres que admite WhatsApp`);
    }
    if (enviar && !contenido) throw new BadRequestException('La guía está vacía');
    const conv = await this.conversacion(empresaId, conversacionId);
    if (!conv.prospecto) throw new BadRequestException('Este chat todavía no tiene ficha de cliente');

    if (enviar) {
      const envio = await this.whatsapp.enviarTexto(conv.telefonoProspecto, contenido, empresaId);
      if (!envio.success) {
        // WhatsApp solo deja escribir libre dentro de las 24 h desde el último
        // mensaje del cliente; afuera hace falta plantilla. La guía ya quedó
        // escrita: se puede copiar y mandar a mano.
        throw new BadRequestException(
          `No se pudo enviar por WhatsApp${envio.error && envio.error !== 'Error' ? ` (${envio.error})` : ''}. Si el cliente no escribió en las últimas 24 horas, guárdala y mándasela desde tu WhatsApp.`,
        );
      }
      await this.prisma.leadMensaje.create({
        data: { conversacionId: conv.id, rol: 'SISTEMA', contenido },
      });
      await this.prisma.leadConversacion.update({
        where: { id: conv.id },
        data: { cantidadMensajes: { increment: 1 } },
      });
    }

    const ahora = new Date();
    await this.prisma.leadProspecto.update({
      where: { id: conv.prospecto.id },
      data: contenido ? { guiaConsumo: contenido, guiaConsumoEn: ahora } : { guiaConsumo: null, guiaConsumoEn: null },
    });
    return { guardada: contenido ? { texto: contenido, en: ahora } : null, enviada: enviar };
  }
}
