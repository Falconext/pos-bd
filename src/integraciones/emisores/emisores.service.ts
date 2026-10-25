import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Los emisores (RUC) por los que puede facturar un integrador.
 *
 * La regla que vive acá es la que separa a un integrador de otro: una API key
 * solo puede emitir por los emisores que ESE integrador dio de alta. Sin ella,
 * conocer un `issuer_id` ajeno bastaría para emitir comprobantes ante SUNAT a
 * nombre de otra empresa — y el `issuer_id` viaja en cada request, así que
 * cualquier integrador ve los suyos y podría probar con otros.
 *
 * Un emisor es una `Empresa` con `integradorId`. No se inventó una entidad
 * nueva: ya tiene RUC, razón social, series y credenciales QPSE, que es
 * exactamente lo que un emisor necesita.
 */
@Injectable()
export class EmisoresService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Identificador público de un emisor.
   *
   * No se expone el id numérico porque es secuencial: decirle a un integrador
   * que es el emisor 412 le dice cuántos clientes tiene Krezka, y le permite
   * probar con 411 y 413.
   */
  static nuevoPublicId(): string {
    return `iss_${randomBytes(9).toString('base64url')}`;
  }

  /** Los emisores de este integrador, para `GET /issuers`. */
  async listar(integradorId: number) {
    const filas = await this.prisma.empresa.findMany({
      where: { integradorId },
      select: {
        apiPublicId: true,
        ruc: true,
        razonSocial: true,
        nombreComercial: true,
        direccion: true,
        usuarioPse: true,
        usaDemo: true,
        fechaActivacion: true,
      },
      orderBy: { id: 'asc' },
    });
    return filas.map((f) => this.aVistaPublica(f));
  }

  /**
   * Resuelve un `issuer_id` comprobando que sea de este integrador.
   *
   * Devuelve el emisor o lanza. Que no exista y que sea de otro integrador
   * dan la MISMA respuesta a propósito: si "no existe" y "no es tuyo" se
   * distinguieran, un integrador podría averiguar qué `issuer_id` son válidos
   * probando y mirando el error.
   */
  async resolverParaIntegrador(integradorId: number, issuerId: string) {
    const emisor = await this.prisma.empresa.findFirst({
      where: { apiPublicId: issuerId, integradorId },
      select: {
        id: true,
        apiPublicId: true,
        ruc: true,
        razonSocial: true,
        nombreComercial: true,
        direccion: true,
        usuarioPse: true,
        usaDemo: true,
        fechaActivacion: true,
        apiEmisorEstado: true,
        apiEmisorDesde: true,
        apiEmisorMotivo: true,
      },
    });
    if (!emisor) {
      throw new ForbiddenException({
        code: 'issuer_forbidden',
        message: `El emisor ${issuerId} no existe o no pertenece a tu integración.`,
        param: 'issuer_id',
      });
    }
    return emisor;
  }

  /**
   * Da de alta una Empresa existente como emisor de un integrador.
   *
   * No crea la empresa: eso pasa por el alta normal, con su RUC validado y
   * sus series. Acá solo se la ata al integrador y se le asigna su id público.
   *
   * Se niega a robar un emisor que ya es de otro integrador: sería la forma
   * más silenciosa de que alguien empiece a facturar por un RUC ajeno.
   */
  async vincular(integradorId: number, empresaId: number) {
    if (integradorId === empresaId) {
      throw new ForbiddenException({
        code: 'issuer_self_reference',
        message: 'Un integrador no puede ser emisor de sí mismo.',
      });
    }
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, integradorId: true, apiPublicId: true, ruc: true },
    });
    if (!empresa) throw new NotFoundException('La empresa no existe.');
    if (empresa.integradorId && empresa.integradorId !== integradorId) {
      throw new ForbiddenException({
        code: 'issuer_already_linked',
        message: 'Esa empresa ya es emisor de otro integrador.',
      });
    }
    return this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        integradorId,
        // Si ya tenía uno, se conserva: cambiarlo rompería las referencias
        // que el integrador guardó de sus comprobantes.
        apiPublicId: empresa.apiPublicId ?? EmisoresService.nuevoPublicId(),
        // Nace pendiente: QPSE tarda ~24 h en completar el alta ante SUNAT y
        // emitir antes quema correlativos que no vuelven.
        apiEmisorEstado: 'pendiente',
        apiEmisorDesde: new Date(),
        apiEmisorMotivo: null,
      },
      select: {
        id: true, apiPublicId: true, ruc: true, integradorId: true,
        apiEmisorEstado: true, apiEmisorDesde: true,
      },
    });
  }

  /** Corta la relación. El RUC y su historia fiscal quedan intactos. */
  async desvincular(integradorId: number, issuerId: string) {
    const { count } = await this.prisma.empresa.updateMany({
      where: { apiPublicId: issuerId, integradorId },
      data: { integradorId: null },
    });
    return count > 0;
  }

  /**
   * Un emisor está listo si tiene con qué firmar.
   *
   * Sin credenciales QPSE la emisión fallaría recién al llamar al proveedor,
   * con un error suyo que el integrador no puede interpretar. Mejor decirlo
   * antes y con nuestras palabras.
   */
  private aVistaPublica(f: {
    apiPublicId: string | null;
    ruc: string | null;
    razonSocial: string | null;
    nombreComercial: string | null;
    direccion: string | null;
    usuarioPse: string | null;
    usaDemo: boolean | null;
    fechaActivacion: Date;
    apiEmisorEstado?: string | null;
    apiEmisorDesde?: Date | null;
    apiEmisorMotivo?: string | null;
  }) {
    const listo = !!f.usuarioPse?.trim();
    return {
      id: f.apiPublicId,
      object: 'issuer' as const,
      ruc: f.ruc,
      legal_name: f.razonSocial,
      trade_name: f.nombreComercial,
      address: f.direccion,
      environment: f.usaDemo ? ('test' as const) : ('live' as const),
      // El estado que importa es el del ciclo de vida: tener credenciales no
      // significa que SUNAT ya habilitó el RUC.
      status: !listo
        ? ('pending_setup' as const)
        : f.apiEmisorEstado === 'bloqueado'
          ? ('not_authorized' as const)
          : f.apiEmisorEstado === 'pendiente'
            ? ('pending' as const)
            : ('active' as const),
      status_detail: f.apiEmisorMotivo ?? undefined,
      // Cuándo se espera que SUNAT lo tenga listo. Orientativo: QPSE dice
      // ~24 h "aunque pueden demorar más si SUNAT presenta intermitencias".
      available_at:
        // Sin credenciales todavía no corre el reloj de las 24 h: decir una
        // fecha a una empresa que ni pidió producción confundía (QA 25-10).
        listo && f.apiEmisorEstado === 'pendiente' && f.apiEmisorDesde
          ? new Date(f.apiEmisorDesde.getTime() + 24 * 60 * 60 * 1000)
          : undefined,
      created_at: f.fechaActivacion,
    };
  }

  /** La vista pública de un emisor ya resuelto. */
  vistaPublica(f: Parameters<EmisoresService['aVistaPublica']>[0]) {
    return this.aVistaPublica(f);
  }
}
