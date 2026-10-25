import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmpresaService } from '../../empresa/empresa.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { EmisoresService } from '../emisores/emisores.service';
import { WebhooksService } from '../../logistica/integraciones/webhooks/webhooks.service';
import { MedidorApiService } from './medidor.service';
import { rucValido, MENSAJE_RUC_INVALIDO } from '../erp/ruc';

/**
 * La consola de developers.krezka.com: lo que en apisunat es "Mis Empresas".
 *
 * Pedido 24-10: que quien ya tiene su sistema se registre, agregue sus
 * empresas por RUC, saque sus claves y facture por la API sin pasar por el
 * sistema Krezka ni pedirle nada a nadie. Todo lo fiscal sigue en la API de
 * facturación; esto solo crea la cuenta, las empresas y las claves.
 *
 * Dos reglas que no se negocian:
 *  - Una empresa nueva nace en PRUEBA (`usaDemo`, sin credenciales del PSE):
 *    con `sk_test_` se prueba todo; con `sk_live_` no emite hasta pasar a
 *    producción. Registrar un RUC no alcanza para facturar a su nombre.
 *  - Un RUC que ya usa Krezka no se puede agregar desde la consola: sería la
 *    forma más simple de facturar a nombre de otro.
 */
@Injectable()
export class ConsolaFacturacionService {
  static readonly PLAN_INTEGRADOR = 'DEVELOPERS · CUENTA';
  static readonly PLAN_EMISOR = 'DEVELOPERS · EMPRESA';
  /** Una cuenta no es un ERP: no vence. */
  private static readonly DIEZ_ANIOS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly empresas: EmpresaService,
    private readonly apiKeys: ApiKeysService,
    private readonly emisores: EmisoresService,
    private readonly webhooks: WebhooksService,
    private readonly medidor: MedidorApiService,
  ) {}

  /** Los planes de la consola: sin módulos del ERP, sin tope de comprobantes. */
  private async plan(nombre: string): Promise<number> {
    const ya = await this.prisma.plan.findFirst({
      where: { nombre, plataforma: 'krezka', producto: 'facturacion' },
      select: { id: true },
    });
    if (ya) return ya.id;
    const creado = await this.prisma.plan.create({
      data: {
        nombre,
        plataforma: 'krezka',
        producto: 'facturacion',
        descripcion: 'Consola de developers.krezka.com: solo API de facturación, cobro por consumo.',
        costo: 0,
        duracionDias: 3650,
        maxComprobantes: null,
        limiteUsuarios: 1,
        maxSedes: 1,
      },
      select: { id: true },
    });
    return creado.id;
  }

  private async sedeYUsuario(empresaId: number, direccion: string, usuarioId?: number) {
    const sede = await this.prisma.sede.create({
      data: { empresaId, nombre: 'Sede Principal', direccion, codigo: '001', esPrincipal: true, activo: true } as any,
      select: { id: true },
    });
    if (usuarioId) {
      await this.prisma.usuarioSede.create({ data: { usuarioId, sedeId: sede.id } as any });
      await this.prisma.usuario.update({ where: { id: usuarioId }, data: { sedeId: sede.id } as any });
    }
    return sede.id;
  }

  /** Alta de la cuenta. Público: es la puerta de entrada. */
  async registrar(body: any) {
    const nombre = String(body?.name ?? '').trim();
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    const organizacion = String(body?.company ?? '').trim();
    if (nombre.length < 3) throw new BadRequestException('Escribe tu nombre.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new BadRequestException('El correo no es válido.');
    if (password.length < 8) throw new BadRequestException('La contraseña debe tener al menos 8 caracteres.');

    const existe = await this.prisma.usuario.findFirst({ where: { email }, select: { id: true } });
    if (existe) throw new ConflictException('Ya hay una cuenta con ese correo. Ingresa con tu contraseña.');

    const planId = await this.plan(ConsolaFacturacionService.PLAN_INTEGRADOR);
    // La cuenta no es un contribuyente: no lleva RUC real. El campo es
    // obligatorio y único, así que va un identificador que no puede chocar
    // con un RUC (empieza con letras).
    let rucCuenta = '';
    for (let i = 0; i < 5 && !rucCuenta; i++) {
      const candidato = `DEV${randomInt(10_000_000, 99_999_999)}`;
      if (!(await this.prisma.empresa.findUnique({ where: { ruc: candidato }, select: { id: true } }))) rucCuenta = candidato;
    }
    const ahora = new Date();
    const empresa = await this.prisma.empresa.create({
      data: {
        ruc: rucCuenta,
        razonSocial: organizacion || nombre,
        nombreComercial: organizacion || nombre,
        direccion: '-',
        planId,
        fechaActivacion: ahora,
        fechaExpiracion: new Date(ahora.getTime() + ConsolaFacturacionService.DIEZ_ANIOS_MS),
        estado: 'ACTIVO',
        brand: 'krezka',
        producto: 'facturacion',
        esIntegradorApi: true,
        usuarios: {
          create: {
            nombre,
            email,
            password: await bcrypt.hash(password, 10),
            dni: '00000000',
            celular: String(body?.phone ?? '').replace(/\D/g, '').slice(-9) || '000000000',
            rol: 'ADMIN_EMPRESA',
            estado: 'ACTIVO',
          },
        },
      } as any,
      select: { id: true, usuarios: { select: { id: true }, take: 1 } },
    });
    await this.sedeYUsuario(empresa.id, '-', empresa.usuarios[0]?.id);
    return { object: 'account', email, name: nombre };
  }

  /** Solo las cuentas de la consola (o un integrador ya existente) usan esto. */
  private async integrador(empresaId: number) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, razonSocial: true, esIntegradorApi: true, _count: { select: { emisores: true } } },
    });
    if (!e || (!e.esIntegradorApi && !e._count.emisores)) {
      throw new ForbiddenException('Esta cuenta no es de la consola de developers.');
    }
    return e;
  }

  async perfil(empresaId: number) {
    const e = await this.integrador(empresaId);
    return { object: 'account', id: e.id, name: e.razonSocial, companies: e._count.emisores };
  }

  // ── Mis empresas ─────────────────────────────────────────────────────

  async listarEmpresas(empresaId: number) {
    await this.integrador(empresaId);
    return { object: 'list', data: await this.emisores.listar(empresaId) };
  }

  async verEmpresa(empresaId: number, issuerId: string) {
    await this.integrador(empresaId);
    const e = await this.emisores.resolverParaIntegrador(empresaId, issuerId);
    return this.emisores.vistaPublica(e);
  }

  /**
   * "Agregar empresa": con el RUC se traen de SUNAT razón social y dirección,
   * se crea la empresa en PRUEBA y se la ata a la cuenta.
   */
  async agregarEmpresa(empresaId: number, body: any) {
    await this.integrador(empresaId);
    const ruc = String(body?.ruc ?? '').replace(/\s/g, '');
    if (!rucValido(ruc)) throw new BadRequestException(MENSAJE_RUC_INVALIDO);

    const ya = await this.prisma.empresa.findUnique({ where: { ruc }, select: { id: true, integradorId: true } });
    if (ya) {
      if (ya.integradorId === empresaId) throw new ConflictException('Esa empresa ya está en tu cuenta.');
      throw new ConflictException(
        'Ese RUC ya está registrado en Krezka. Si es tu empresa y quieres facturar por la API, escríbenos y la vinculamos.',
      );
    }

    let sunat: any;
    try {
      sunat = await this.empresas.consultarRuc(ruc);
    } catch {
      sunat = null;
    }
    if (!sunat?.nombre_o_razon_social) {
      throw new BadRequestException('No pudimos consultar ese RUC en SUNAT. Revisa el número o intenta en unos minutos.');
    }
    const estado = String(sunat.estado ?? '').toUpperCase();
    if (estado && estado !== 'ACTIVO') {
      throw new BadRequestException(`SUNAT tiene ese RUC como "${sunat.estado}": no puede emitir comprobantes.`);
    }

    const direccion = String(sunat.direccion_completa || sunat.direccion || '-').trim() || '-';
    const ahora = new Date();
    const nueva = await this.prisma.empresa.create({
      data: {
        ruc,
        razonSocial: String(sunat.nombre_o_razon_social).trim(),
        nombreComercial: String(body?.trade_name ?? '').trim() || String(sunat.nombre_o_razon_social).trim(),
        direccion,
        departamento: sunat.departamento ?? null,
        provincia: sunat.provincia ?? null,
        distrito: sunat.distrito ?? null,
        ubigeo: Array.isArray(sunat.ubigeo) ? sunat.ubigeo[2] : (sunat.ubigeo ?? null),
        planId: await this.plan(ConsolaFacturacionService.PLAN_EMISOR),
        fechaActivacion: ahora,
        fechaExpiracion: new Date(ahora.getTime() + ConsolaFacturacionService.DIEZ_ANIOS_MS),
        estado: 'ACTIVO',
        brand: 'krezka',
        producto: 'facturacion',
        billingProvider: 'QPSE',
        // En prueba hasta pasar a producción: sin credenciales del PSE no
        // emite en vivo (habilitacion.ts), y `usaDemo` apunta a SUNAT beta.
        usaDemo: true,
        clientes: {
          create: { nombre: 'CLIENTES VARIOS', nroDoc: '10000000', estado: 'ACTIVO', tipoDocumento: { connect: { codigo: '1' } } },
        },
      } as any,
      select: { id: true },
    });
    await this.sedeYUsuario(nueva.id, direccion);
    await this.emisores.vincular(empresaId, nueva.id);
    return this.verEmpresa(empresaId, (await this.prisma.empresa.findUnique({ where: { id: nueva.id }, select: { apiPublicId: true } }))!.apiPublicId!);
  }

  // ── Claves ───────────────────────────────────────────────────────────

  async listarClaves(empresaId: number) {
    await this.integrador(empresaId);
    return this.apiKeys.listKeys(empresaId, 'facturacion');
  }

  /** La clave completa se devuelve UNA sola vez. */
  async crearClave(empresaId: number, body: any) {
    await this.integrador(empresaId);
    const nombre = String(body?.name ?? '').trim().slice(0, 60) || undefined;
    return this.apiKeys.generateKey(empresaId, 'facturacion', { nombre, entorno: body?.environment === 'live' ? 'live' : 'test' });
  }

  async revocarClave(empresaId: number, id: number) {
    await this.integrador(empresaId);
    const r = await this.apiKeys.revokeKey(empresaId, 'facturacion', id);
    if (!r) throw new NotFoundException('La clave no existe.');
    return r;
  }

  // ── Webhooks y consumo ───────────────────────────────────────────────

  async crearWebhook(empresaId: number, body: any) {
    await this.integrador(empresaId);
    return this.webhooks.createEndpoint(empresaId, body, 'facturacion');
  }

  async listarWebhooks(empresaId: number) {
    await this.integrador(empresaId);
    return { object: 'list', data: await this.webhooks.listEndpoints(empresaId, 'facturacion') };
  }

  async borrarWebhook(empresaId: number, id: string) {
    await this.integrador(empresaId);
    const r = await this.webhooks.deleteEndpoint(empresaId, id);
    if (!r) throw new NotFoundException('El webhook no existe.');
    return r;
  }

  async consumo(empresaId: number, periodo?: string) {
    await this.integrador(empresaId);
    return this.medidor.consumo(empresaId, periodo);
  }
}
