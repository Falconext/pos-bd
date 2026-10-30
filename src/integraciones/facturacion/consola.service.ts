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
import { QpseClient } from '../../common/utils/qpse.client';
import { pasarRucAProduccion } from '../../common/utils/qpse-cuenta';
import { FacturacionApiService } from './facturacion.service';
import { ClienteService } from '../../cliente/cliente.service';
import { CobrosApiService } from './cobros-api.service';

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
    private readonly qpse: QpseClient,
    private readonly facturacion: FacturacionApiService,
    private readonly clientes: ClienteService,
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

  // ── Pasar a producción ───────────────────────────────────────────────

  /**
   * "Pasar a producción" sin que nadie entre al panel de QPSE.
   *
   * Contra la cuenta de Krezka en QPSE: si el RUC no está, se registra; si
   * está en demo, se pasa a producción (IRREVERSIBLE allá, por eso se pide
   * `confirm: true`); y con el usuario y contraseña de firma que devuelve se
   * deja la empresa en vivo. Queda `pendiente` las ~24 h que tarda el alta
   * ante SUNAT (habilitacion.ts), así no quema correlativos mientras tanto.
   *
   * Cada paso se puede repetir: si se corta a la mitad (o hacen doble clic),
   * el segundo intento retoma donde quedó en vez de fallar.
   *
   * Es el mismo flujo que el pase a producción de los resellers en Vendify:
   * la afiliación a QPSE es de la cuenta de Krezka y QPSE hace el alta ante
   * SUNAT, así que al contribuyente no se le pide trámite en SOL. Si SUNAT
   * igual lo rechaza (0111/0154), queda `not_authorized` con el motivo.
   */
  async pasarAProduccion(empresaId: number, issuerId: string, body: any) {
    await this.integrador(empresaId);
    const e = await this.emisores.resolverParaIntegrador(empresaId, issuerId);
    if (!e.usaDemo && e.usuarioPse?.trim()) return this.emisores.vistaPublica(e);
    if (body?.confirm !== true) {
      throw new BadRequestException('Confirma el pase a producción: no se puede deshacer.');
    }
    const fila = await pasarRucAProduccion(this.qpse, String(e.ruc ?? ''));

    await this.prisma.empresa.update({
      where: { id: e.id },
      data: {
        usuarioPse: fila.username,
        contrasenaPse: fila.password,
        usaDemo: false,
        apiEmisorEstado: 'pendiente',
        apiEmisorDesde: new Date(),
        apiEmisorMotivo: null,
      },
    });
    return this.verEmpresa(empresaId, issuerId);
  }

  // ── Probar ───────────────────────────────────────────────────────────

  /**
   * El formulario "Probar" de la consola: lo mismo que `POST /v1/invoicing/
   * invoices` con una clave `sk_test_`, pero con la sesión. Así se prueba el
   * primer comprobante antes de tener una clave y se ve el JSON exacto que
   * hay que mandar. Corre las validaciones de verdad; no emite ni cobra.
   */
  async probar(empresaId: number, body: any) {
    await this.integrador(empresaId);
    return this.facturacion.emitir(empresaId, body ?? {}, true);
  }

  // ── Documentos ───────────────────────────────────────────────────────

  /*
   * "Mis documentos": lo mismo que /v1/invoicing pero con la sesión, para
   * quien quiere ver, descargar o emitir sin escribir código. Todo pasa por
   * FacturacionApiService: un comprobante emitido aquí y uno emitido por la
   * API son el mismo comprobante, se cuentan igual y avisan igual.
   */

  async listarDocumentos(empresaId: number, q: { issuer_id?: string; cursor?: string; limit?: string }) {
    await this.integrador(empresaId);
    return this.facturacion.listar(empresaId, {
      issuerId: q?.issuer_id || undefined,
      cursor: q?.cursor || undefined,
      limite: Number(q?.limit) || 25,
    });
  }

  async verDocumento(empresaId: number, id: string) {
    await this.integrador(empresaId);
    return this.facturacion.obtener(empresaId, id);
  }

  async archivoDocumento(empresaId: number, id: string, archivo: string, formato?: string) {
    await this.integrador(empresaId);
    if (archivo === 'xml') return this.facturacion.xml(empresaId, id);
    if (archivo === 'cdr') return this.facturacion.cdr(empresaId, id);
    if (archivo === 'pdf') {
      const f = ['a4', 'a5', 'ticket'].includes(String(formato)) ? (formato as any) : 'a4';
      return this.facturacion.pdf(empresaId, id, f);
    }
    throw new NotFoundException('Ese archivo no existe.');
  }

  /** Emite DE VERDAD: va a SUNAT y se cobra. La puerta de habilitación aplica igual. */
  async emitirDocumento(empresaId: number, body: any) {
    await this.integrador(empresaId);
    return this.facturacion.emitir(empresaId, body ?? {}, false);
  }

  async anularDocumento(empresaId: number, id: string, body: any) {
    await this.integrador(empresaId);
    return this.facturacion.anular(empresaId, id, body?.reason, false);
  }

  // ── Datos de facturación ─────────────────────────────────────────────

  /** A nombre de quién le facturamos el consumo. */
  async verDatosFacturacion(empresaId: number) {
    await this.integrador(empresaId);
    const e = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { datosFacturacion: true } });
    const d = (e?.datosFacturacion ?? null) as any;
    return {
      object: 'billing_details',
      complete: !!CobrosApiService.datosValidos(d),
      document_type: d?.tipo ?? null,
      document_number: d?.numero ?? null,
      name: d?.nombre ?? null,
      address: d?.direccion ?? null,
      email: d?.email ?? null,
    };
  }

  async guardarDatosFacturacion(empresaId: number, body: any) {
    await this.integrador(empresaId);
    const tipo = String(body?.document_type ?? '').toLowerCase();
    const numero = String(body?.document_number ?? '').replace(/\D/g, '');
    const nombre = String(body?.name ?? '').trim();
    const direccion = String(body?.address ?? '').trim();
    const email = String(body?.email ?? '').trim().toLowerCase();
    if (tipo !== 'ruc' && tipo !== 'dni') throw new BadRequestException('Elige RUC o DNI.');
    if (tipo === 'ruc' && !rucValido(numero)) throw new BadRequestException(MENSAJE_RUC_INVALIDO);
    if (tipo === 'dni' && !/^\d{8}$/.test(numero)) throw new BadRequestException('El DNI tiene 8 dígitos.');
    if (nombre.length < 3) throw new BadRequestException(tipo === 'ruc' ? 'Escribe la razón social.' : 'Escribe el nombre completo.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new BadRequestException('El correo no es válido.');
    // Una factura a un RUC lleva dirección fiscal; sin ella SUNAT la puede observar.
    if (tipo === 'ruc' && direccion.length < 5) throw new BadRequestException('Escribe la dirección fiscal.');
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        datosFacturacion: {
          tipo,
          numero,
          nombre,
          ...(direccion ? { direccion } : {}),
          ...(email ? { email } : {}),
        },
      },
    });
    return this.verDatosFacturacion(empresaId);
  }

  /** Autocompleta nombre y dirección desde SUNAT (RUC) o RENIEC (DNI). */
  async consultarDocumento(empresaId: number, tipo: string, numero: string) {
    await this.integrador(empresaId);
    const t = String(tipo).toLowerCase();
    const n = String(numero ?? '').replace(/\D/g, '');
    if (t === 'ruc') {
      if (!rucValido(n)) throw new BadRequestException(MENSAJE_RUC_INVALIDO);
      const r: any = await this.empresas.consultarRuc(n).catch(() => null);
      if (!r?.nombre_o_razon_social) throw new BadRequestException('No encontramos ese RUC en SUNAT. Escribe los datos a mano.');
      return { name: String(r.nombre_o_razon_social).trim(), address: String(r.direccion_completa || r.direccion || '').trim() || null };
    }
    if (t === 'dni') {
      if (!/^\d{8}$/.test(n)) throw new BadRequestException('El DNI tiene 8 dígitos.');
      const r: any = await this.clientes.consultarDocumento(n, 'DNI').catch(() => null);
      const nombre = r?.nombre_completo || [r?.nombres, r?.apellido_paterno, r?.apellido_materno].filter(Boolean).join(' ');
      if (!nombre) throw new BadRequestException('No encontramos ese DNI. Escribe el nombre a mano.');
      return { name: String(nombre).trim(), address: null };
    }
    throw new BadRequestException('Elige RUC o DNI.');
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
