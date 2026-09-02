import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';

type PlanSalesfilter = 'GRATIS' | 'EMPRENDEDOR' | 'NEGOCIO' | 'AGENCIA';

export interface ResultadoProvision {
  ok: boolean;
  userId?: string;
  error?: string;
  omitido?: boolean;
}

/**
 * Puente de provisioning MYPE → SalesFilter.
 *
 * MYPE es el master de creación. Cuando una empresa contrata "solo ventas" (o
 * "ambos"), se hace upsert de su cuenta espejo en SalesFilter para que el
 * cliente inicie sesión allá con las MISMAS credenciales (se envía el hash
 * bcrypt ya cifrado, nunca la contraseña en claro). Best-effort: nunca lanza;
 * si SalesFilter no está configurado/disponible, se omite y se registra.
 */
@Injectable()
export class SalesfilterBridgeService {
  private readonly logger = new Logger(SalesfilterBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** ¿El producto contratado requiere cuenta en SalesFilter? */
  debeProvisionar(producto: string | null | undefined): boolean {
    return producto === 'SOLO_VENTAS' || producto === 'AMBOS';
  }

  /**
   * Provisiona (crea/actualiza) la cuenta de la empresa en SalesFilter.
   * Idempotente: guarda `salesfilterUserId` en la Empresa.
   */
  async provisionarEmpresa(empresaId: number): Promise<ResultadoProvision> {
    const baseUrl = this.config.get<string>('SALESFILTER_API_URL');
    const apiKey = this.config.get<string>('SALESFILTER_API_KEY');
    if (!baseUrl || !apiKey) {
      this.logger.warn(
        'SalesFilter no configurado (SALESFILTER_API_URL/API_KEY); se omite el provisioning.',
      );
      return { ok: false, omitido: true, error: 'SalesFilter no configurado' };
    }

    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        razonSocial: true,
        nombreComercial: true,
        iaVentasContexto: true,
        productoContratado: true,
        plan: { select: { nombre: true } },
        usuarios: {
          where: { rol: 'ADMIN_EMPRESA' },
          select: { nombre: true, email: true, password: true, celular: true },
          orderBy: { id: 'asc' },
          take: 1,
        },
      },
    });

    if (!empresa) return { ok: false, error: 'Empresa no encontrada' };
    const owner = empresa.usuarios[0];
    if (!owner?.email) {
      return { ok: false, error: 'La empresa no tiene un ADMIN_EMPRESA con email' };
    }

    const payload = {
      email: owner.email,
      nombre: owner.nombre,
      nombreNegocio: empresa.nombreComercial || empresa.razonSocial,
      descripcionNegocio: empresa.iaVentasContexto ?? undefined,
      telefonoAviso: owner.celular ?? undefined,
      // Hash bcrypt ya cifrado (MYPE y SalesFilter usan bcrypt compatible).
      passwordHash: owner.password ?? undefined,
      plan: this.mapearPlan(empresa.plan?.nombre),
    };

    try {
      const { data } = await axios.post(
        `${baseUrl.replace(/\/$/, '')}/api/provision`,
        payload,
        { headers: { 'x-api-key': apiKey }, timeout: 15000 },
      );
      const userId: string | undefined = data?.userId;
      if (userId) {
        await this.prisma.empresa.update({
          where: { id: empresaId },
          data: { salesfilterUserId: userId },
        });
      }
      this.logger.log(
        `SalesFilter: empresa ${empresaId} provisionada (userId ${userId}, ${data?.created ? 'creado' : 'actualizado'}).`,
      );
      return { ok: true, userId };
    } catch (e: any) {
      const msg =
        e?.response?.data?.error || e?.message || 'Error desconocido';
      this.logger.error(
        `SalesFilter: provisioning de empresa ${empresaId} falló: ${msg}`,
      );
      return { ok: false, error: String(msg) };
    }
  }

  /**
   * Mapea el plan de MYPE al enum de SalesFilter. Best-effort por palabra clave;
   * default NEGOCIO. Ajustable luego con una tabla de mapeo real.
   */
  private mapearPlan(nombre?: string | null): PlanSalesfilter {
    const n = (nombre ?? '').toLowerCase();
    if (/gratis|free|trial|prueba/.test(n)) return 'GRATIS';
    if (/emprend|basico|básico|starter|inicial/.test(n)) return 'EMPRENDEDOR';
    if (/agencia|enterprise|premium|corporativo|ilimitado/.test(n)) return 'AGENCIA';
    return 'NEGOCIO';
  }
}
