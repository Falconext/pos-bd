import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import bcrypt from 'bcrypt';
import { CreateEmpresaDto } from './dto/create-empresa.dto';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';
import {
  CreateCuentaBancariaDto,
  UpdateCuentaBancariaDto,
} from './dto/cuenta-bancaria.dto';
import { SedeService } from '../sede/sede.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { PdfGeneratorService } from '../comprobante/pdf-generator.service';
import { S3Service } from '../s3/s3.service';
import { FIRMA_KREZKA_DATA_URI } from './firma-krezka';
import { LOGO_KREZKA_DATA_URI } from './logo-krezka';

function parseDDMMYYYY(input: string): Date {
  if (!input || input.trim() === '') {
    throw new ForbiddenException('Fecha no puede estar vacía');
  }

  // Detectar formato ISO (yyyy-MM-dd) vs formato dd/MM/yyyy
  if (input.includes('-')) {
    // Formato ISO: yyyy-MM-dd
    const [yyyy, mm, dd] = input.split('-').map((s) => parseInt(s, 10));
    if (!dd || !mm || !yyyy || isNaN(dd) || isNaN(mm) || isNaN(yyyy)) {
      throw new ForbiddenException(`Fecha inválida: ${input}`);
    }
    return new Date(Date.UTC(yyyy, mm - 1, dd));
  } else {
    // Formato dd/MM/yyyy
    const [dd, mm, yyyy] = input.split('/').map((s) => parseInt(s, 10));
    if (!dd || !mm || !yyyy || isNaN(dd) || isNaN(mm) || isNaN(yyyy)) {
      throw new ForbiddenException(`Fecha inválida: ${input}`);
    }
    return new Date(Date.UTC(yyyy, mm - 1, dd));
  }
}

function formatDateEsPeDateOnly(value?: Date | null): string {
  if (!value) return '';
  const [yyyy, mm, dd] = value.toISOString().slice(0, 10).split('-');
  return `${dd}/${mm}/${yyyy}`;
}

function getDaysRemainingDateOnly(value?: Date | null): number {
  if (!value) return 0;
  const [yyyy, mm, dd] = value
    .toISOString()
    .slice(0, 10)
    .split('-')
    .map(Number);
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const targetUtc = Date.UTC(yyyy, mm - 1, dd);
  return Math.ceil((targetUtc - todayUtc) / 86400000);
}

function formatDaysLabel(days: number): string {
  const abs = Math.abs(days);
  const label = `${abs} día${abs === 1 ? '' : 's'}`;
  if (days < 0) return `venció hace ${label}`;
  if (days === 0) return 'vence hoy';
  return `vence en ${label}`;
}

function buildReminderSubject(days: number, empresaNombre: string): string {
  if (days < 0) {
    const expiredDays = Math.abs(days);
    return `Tu suscripción venció hace ${expiredDays} día${expiredDays === 1 ? '' : 's'} — ${empresaNombre}`;
  }
  if (days === 0) return `Tu suscripción vence hoy — ${empresaNombre}`;
  return `Tu suscripción vence en ${days} día${days === 1 ? '' : 's'} — ${empresaNombre}`;
}

function normalizeBrand(value?: string | null): 'falconext' | 'krezka' {
  return String(value ?? '')
    .trim()
    .toLowerCase() === 'krezka'
    ? 'krezka'
    : 'falconext';
}

function normalizeProducto(
  value?: string | null,
): 'facturacion' | 'hotel' | 'logistica' {
  const v = String(value ?? '')
    .trim()
    .toLowerCase();
  if (v === 'hotel') return 'hotel';
  if (v === 'logistica') return 'logistica';
  return 'facturacion';
}

function mapHotelPlanName(planNombre?: string | null): string {
  const raw = String(planNombre ?? '')
    .trim()
    .toUpperCase();
  if (!raw) return 'BASIC';
  if (raw.includes('PREMIUM')) return 'PREMIUM';
  if (raw.includes('PRO')) return 'PROFESSIONAL';
  if (raw.includes('PROFES')) return 'PROFESSIONAL';
  return raw.replace(/\s+/g, '_');
}

function resolveAppAccessUrl(empresa?: {
  brand?: string | null;
  producto?: string | null;
}): string {
  if (process.env.APP_WEB_URL) return process.env.APP_WEB_URL;
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  if (normalizeBrand(empresa?.brand) === 'krezka')
    return 'https://app.krezka.com';
  return 'https://app.falconext.pe';
}

function esPlanPermitidoParaPrecioFefo(planNombre?: string | null): boolean {
  const raw = String(planNombre ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  return raw.includes('NEGOCIO') || raw.includes('CORPORAT');
}

function isDemoBillingUrl(value?: string | null): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return /(demo|sandbox|homolog|homologacion|beta|test|testing|staging|qa)/i.test(
    normalized,
  );
}

function resolveAmbienteFacturacion(empresa: {
  usaDemo?: boolean | null;
  billingApiBaseUrl?: string | null;
  billingApiDemoBaseUrl?: string | null;
}): 'DEMO' | 'PRODUCCIÓN' {
  const effectiveUrl = String(
    empresa.usaDemo
      ? empresa.billingApiDemoBaseUrl || empresa.billingApiBaseUrl || ''
      : empresa.billingApiBaseUrl || '',
  ).trim();

  if (empresa.usaDemo || isDemoBillingUrl(effectiveUrl)) return 'DEMO';
  return 'PRODUCCIÓN';
}

const EMPRESA_SERIE_TIPOS_PERMITIDOS = [
  '01',
  '03',
  '07:01',
  '07:03',
  '08:01',
  '08:03',
  '09',
  '31',
] as const;

type EmpresaSerieTipo = (typeof EMPRESA_SERIE_TIPOS_PERMITIDOS)[number];

interface EmpresaSerieInput {
  tipoDoc?: string;
  serie?: string;
  correlativo?: number;
  activo?: boolean;
}

interface HotelSyncPayload {
  mypeEmpresaId: number;
  mypeUsuarioId?: number;
  hotelName: string;
  tradeName?: string;
  ruc?: string;
  address?: string;
  city?: string;
  department?: string;
  phone?: string;
  email?: string;
  adminEmail: string;
  adminPassword?: string;
  adminFirstName: string;
  adminLastName: string;
  adminPhone?: string;
  isActive: boolean;
  producto: 'hotel';
  plan?: string;
  planExpiresAt?: string;
}

@Injectable()
export class EmpresaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sedeService: SedeService,
    private readonly whatsappService: WhatsAppService,
    @Inject(forwardRef(() => PdfGeneratorService))
    private readonly pdfGenerator: PdfGeneratorService,
    private readonly s3Service: S3Service,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Contrato de servicios (PDF autollenado) — descarga / envío por correo o WhatsApp
  // ─────────────────────────────────────────────────────────────────────────
  private async construirDatosContrato(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: {
        plan: { select: { nombre: true, costo: true } },
        usuarios: {
          where: { rol: 'ADMIN_EMPRESA' },
          orderBy: { id: 'asc' },
          select: { nombre: true, email: true, celular: true },
          take: 1,
        },
      },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    const admin = empresa.usuarios?.[0];
    const planNombre = empresa.plan?.nombre || '';
    const pn = planNombre.toLowerCase();
    const esEmprendedor = pn.includes('emprendedor');
    const esNegocio = pn.includes('negocio');
    const esCorporativo = pn.includes('corporativo');
    const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const hoy = new Date();
    const data = {
      cliente: empresa.razonSocial,
      dniRuc: empresa.ruc,
      correo: admin?.email || '',
      telefono: admin?.celular || '',
      planNombre,
      esEmprendedor,
      esNegocio,
      esCorporativo,
      esOtro: !esEmprendedor && !esNegocio && !esCorporativo,
      pagoMensual: Number(empresa.plan?.costo ?? 0).toFixed(2),
      fecha: `${hoy.getDate()} de ${MESES[hoy.getMonth()]} del ${hoy.getFullYear()}`,
      firmaKrezka: FIRMA_KREZKA_DATA_URI,
      logoKrezka: LOGO_KREZKA_DATA_URI,
    };
    const safe = String(empresa.razonSocial || 'cliente')
      .replace(/[^a-z0-9]+/gi, '_')
      .slice(0, 40);
    const filename = `Contrato_KREZKA_${safe}.pdf`;
    return { empresa, admin, data, filename };
  }

  async generarContratoPdf(empresaId: number): Promise<{ buffer: Buffer; filename: string }> {
    const { data, filename } = await this.construirDatosContrato(empresaId);
    const buffer = await this.pdfGenerator.generarContrato(data);
    return { buffer, filename };
  }

  async enviarContrato(empresaId: number, canal: 'email' | 'whatsapp') {
    const { empresa, admin, data, filename } = await this.construirDatosContrato(empresaId);
    const buffer = await this.pdfGenerator.generarContrato(data);

    if (canal === 'email') {
      const correo = admin?.email;
      if (!correo) throw new BadRequestException('El cliente no tiene un correo registrado');
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) throw new BadRequestException('Envío de correo no configurado (RESEND_API_KEY)');
      const { Resend } = await import('resend');
      const resend = new Resend(resendKey);
      const fromEmail =
        process.env.RESEND_FROM_EMAIL || process.env.MAIL_FROM || 'noreply@falconext.pe';
      const { error } = await resend.emails.send({
        from: `KREZKA <${fromEmail}>`,
        to: correo,
        subject: 'Contrato de Prestación de Servicios — KREZKA',
        html: `<p>Estimado(a) ${empresa.razonSocial},</p><p>Adjuntamos el <strong>Contrato de Prestación de Servicios Digitales</strong> correspondiente a tu plan <strong>${data.planNombre || '—'}</strong>. Por favor revísalo, fírmalo y devuélvelo.</p><p>Gracias por confiar en KREZKA.</p>`,
        attachments: [{ filename, content: buffer }],
      });
      if (error) throw new BadRequestException(error.message);
      return { canal, destino: correo };
    }

    // WhatsApp: se sube el PDF a S3 y se envía como documento (con la firma incluida).
    const telefono = admin?.celular;
    if (!telefono) throw new BadRequestException('El cliente no tiene un teléfono registrado');
    const key = `contratos/empresa-${empresaId}/${Date.now()}-${filename}`;
    await this.s3Service.uploadPDF(buffer, key);
    const url = await this.s3Service.getSignedGetUrl(key, 7 * 24 * 3600);
    const caption = `📄 *KREZKA*\nHola ${empresa.razonSocial}, te compartimos tu *Contrato de Prestación de Servicios* (Plan ${data.planNombre || '—'}). Revísalo, fírmalo y devuélvelo. ¡Gracias por tu confianza!`;
    const res = await this.whatsappService.enviarDocumentoUrl(telefono, url, filename, caption);
    if (!res.success) throw new BadRequestException(res.error || 'No se pudo enviar por WhatsApp');
    return { canal, destino: telefono };
  }

  private async asegurarSedePrincipalPorDefecto(
    empresaId: number,
    direccion?: string | null,
  ) {
    const principal = await this.prisma.sede.findFirst({
      where: { empresaId, esPrincipal: true },
      select: { id: true, activo: true },
    });

    if (principal) {
      if (!principal.activo) {
        await this.prisma.sede.update({
          where: { id: principal.id },
          data: { activo: true },
        });
      }
      return { id: principal.id };
    }

    // Self-healing: si por algún flujo externo no existe sede principal, crearla.
    return this.prisma.sede.create({
      data: {
        empresaId,
        nombre: 'Sede Principal',
        direccion: direccion ?? null,
        codigo: '001',
        esPrincipal: true,
        activo: true,
      },
      select: { id: true },
    });
  }

  private async asegurarAccesoEmpresaSistema(
    empresaId: number,
    adminSistemaNegocio?: string | null,
    adminSistemaProducto?: string | null,
  ) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, brand: true, producto: true },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    if (
      adminSistemaNegocio &&
      normalizeBrand(empresa.brand) !== normalizeBrand(adminSistemaNegocio)
    ) {
      throw new ForbiddenException('No tienes acceso a esta empresa');
    }
    if (
      adminSistemaProducto &&
      normalizeProducto(empresa.producto) !==
        normalizeProducto(adminSistemaProducto)
    ) {
      throw new ForbiddenException('No tienes acceso a esta empresa');
    }
    return empresa;
  }

  private normalizarSeriesEmpresa(series: EmpresaSerieInput[]) {
    const vistos = new Set<string>();
    return (series || []).map((item) => {
      const tipoDoc = String(item.tipoDoc || '').trim() as EmpresaSerieTipo;
      if (!EMPRESA_SERIE_TIPOS_PERMITIDOS.includes(tipoDoc)) {
        throw new BadRequestException(
          'Tipo de documento no permitido para serie',
        );
      }
      if (vistos.has(tipoDoc)) {
        throw new BadRequestException('Hay tipos de documento duplicados');
      }
      vistos.add(tipoDoc);

      const serie = String(item.serie || '')
        .trim()
        .toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(serie)) {
        throw new BadRequestException(
          `La serie ${serie || '(vacía)'} debe tener 4 caracteres alfanuméricos`,
        );
      }

      const correlativo = Number(item.correlativo || 1);
      if (!Number.isInteger(correlativo) || correlativo < 1) {
        throw new BadRequestException(
          `El correlativo de ${serie} debe ser mayor o igual a 1`,
        );
      }

      return {
        tipoDoc,
        serie,
        correlativo,
        activo: item.activo !== false,
      };
    });
  }

  private getHotelSyncConfig() {
    const baseUrl = (process.env.HOTEL_BACKEND_SYNC_URL || '').trim();
    const syncToken = (process.env.HOTEL_BACKEND_SYNC_TOKEN || '').trim();
    return { baseUrl, syncToken };
  }

  private async callHotelSync(
    payload: HotelSyncPayload,
  ): Promise<{ tenantId: string; adminUserId: string }> {
    const { baseUrl, syncToken } = this.getHotelSyncConfig();
    if (!baseUrl || !syncToken) {
      throw new ForbiddenException(
        'Falta configurar HOTEL_BACKEND_SYNC_URL / HOTEL_BACKEND_SYNC_TOKEN',
      );
    }

    try {
      const response = await axios.post(baseUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-sync-token': syncToken,
        },
        timeout: 12000,
      });

      const data = response?.data || {};
      if (!data.tenantId || !data.adminUserId) {
        throw new Error('Respuesta inválida desde Falconext Hotel');
      }
      return { tenantId: data.tenantId, adminUserId: data.adminUserId };
    } catch (error: any) {
      const message =
        error?.response?.data?.message ||
        error?.message ||
        'Error de sincronización';
      throw new ForbiddenException(
        `No se pudo sincronizar con Falconext Hotel: ${message}`,
      );
    }
  }

  private async buildHotelSyncPayload(
    empresaId: number,
    adminPassword?: string,
  ): Promise<HotelSyncPayload> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { plan: true },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    if (normalizeProducto(empresa.producto) !== 'hotel') {
      throw new ForbiddenException(
        'Solo aplica para empresas de producto HOTEL',
      );
    }

    const admin = await this.prisma.usuario.findFirst({
      where: { empresaId, rol: { in: ['ADMIN_EMPRESA', 'ADMIN_SISTEMA'] } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        email: true,
        nombre: true,
        celular: true,
      },
    });
    if (!admin) {
      throw new ForbiddenException(
        'La empresa no tiene usuario administrador para sincronizar',
      );
    }

    const [firstName, ...rest] = String(admin.nombre || '')
      .trim()
      .split(/\s+/);
    const lastName = rest.join(' ').trim() || 'Administrador';

    return {
      mypeEmpresaId: empresa.id,
      mypeUsuarioId: admin.id,
      hotelName: empresa.nombreComercial || empresa.razonSocial,
      tradeName: empresa.nombreComercial || empresa.razonSocial,
      ruc: empresa.ruc || undefined,
      address: empresa.direccion || undefined,
      city: empresa.distrito || undefined,
      department: empresa.departamento || undefined,
      phone: admin.celular || undefined,
      email: admin.email || undefined,
      adminEmail: admin.email,
      adminPassword: adminPassword || undefined,
      adminFirstName: firstName || 'Admin',
      adminLastName: lastName,
      adminPhone: admin.celular || undefined,
      isActive: empresa.estado === 'ACTIVO',
      producto: 'hotel',
      plan: mapHotelPlanName(empresa.plan?.nombre),
      planExpiresAt: empresa.fechaExpiracion
        ? empresa.fechaExpiracion.toISOString()
        : undefined,
    };
  }

  private async sincronizarEmpresaHotel(
    empresaId: number,
    adminPassword?: string,
  ) {
    const payload = await this.buildHotelSyncPayload(empresaId, adminPassword);
    const synced = await this.callHotelSync(payload);

    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: {
        hotelTenantId: synced.tenantId,
        hotelAdminUserId: synced.adminUserId,
        hotelSyncAt: new Date(),
      },
    });

    return synced;
  }

  async crear(
    data: CreateEmpresaDto,
    adminSistemaNegocio?: string | null,
    adminUserId?: number,
    adminSistemaProducto?: string | null,
  ) {
    const fechaActivacion = parseDDMMYYYY(data.fechaActivacion);
    const tipoEmpresa = data.tipoEmpresa || 'FORMAL';
    const esPrueba = data.esPrueba || false;
    const productoEmpresa = adminSistemaProducto
      ? normalizeProducto(adminSistemaProducto)
      : normalizeProducto(data.producto || 'facturacion');

    const exist = await this.prisma.empresa.findUnique({
      where: { ruc: data.ruc },
    });
    if (exist) throw new ForbiddenException('Empresa ya registrada');

    const hashed = await bcrypt.hash(data.usuario.password, 10);

    // Asignar plan automáticamente
    let planId = data.planId || 0;
    if (!planId || planId === 0) {
      // Si es versión de prueba, buscar plan de prueba
      if (esPrueba) {
        const planPrueba = await this.prisma.plan.findFirst({
          where: { esPrueba: true, producto: productoEmpresa },
        });
        if (planPrueba) {
          planId = planPrueba.id;
        } else {
          throw new ForbiddenException(
            'No hay plan de prueba disponible en el sistema',
          );
        }
      } else {
        // Buscar plan según tipo de empresa
        const plan = await this.prisma.plan.findFirst({
          where: {
            nombre:
              tipoEmpresa === 'INFORMAL'
                ? 'Mi Básico Informal'
                : 'Básico Formal',
            esPrueba: false,
            producto: productoEmpresa,
          },
        });
        if (plan) {
          planId = plan.id;
        } else {
          // Si no existe plan específico, usar el primer plan no-prueba disponible
          const firstPlan = await this.prisma.plan.findFirst({
            where: { esPrueba: false, producto: productoEmpresa },
          });
          if (!firstPlan) {
            throw new ForbiddenException(
              'No hay planes disponibles en el sistema',
            );
          }
          planId = firstPlan.id;
        }
      }
    }

    // Obtener duración del plan seleccionado
    const planSeleccionado = await this.prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!planSeleccionado) {
      throw new ForbiddenException('Plan seleccionado no encontrado');
    }
    if (normalizeProducto(planSeleccionado.producto) !== productoEmpresa) {
      throw new ForbiddenException(
        'El plan seleccionado no pertenece al producto de la empresa',
      );
    }

    // Calcular fecha de expiración usando duración del plan
    const ahora = new Date();
    const diasExpiracion = planSeleccionado.duracionDias || 30;
    let expiracion: Date;

    if (data.fechaExpiracion) {
      // Si viene fechaExpiracion del frontend, usarla
      expiracion = parseDDMMYYYY(data.fechaExpiracion);
    } else {
      // Si no, calcularla automáticamente
      expiracion = new Date(
        ahora.getTime() + diasExpiracion * 24 * 60 * 60 * 1000,
      );
    }

    // Obtener la primera unidad de medida disponible
    const unidadMedida = await this.prisma.unidadMedida.findFirst();
    if (!unidadMedida) {
      throw new ForbiddenException(
        'No hay unidades de medida disponibles en el sistema',
      );
    }

    const empresa = await this.prisma.empresa.create({
      data: {
        ruc: data.ruc,
        razonSocial: data.razonSocial,
        direccion: data.direccion,
        logo: data.logo || '',
        planId,
        tipoEmpresa,
        fechaActivacion,
        departamento: data.departamento,
        rubroId: data.rubroId && data.rubroId > 0 ? data.rubroId : null,
        nombreComercial: data.nombreComercial,
        provincia: data.provincia,
        distrito: data.distrito,
        ubigeo: data.ubigeo,
        fechaExpiracion: expiracion,
        estado: 'ACTIVO',
        providerToken: data.providerToken || null,
        providerId: data.providerId || null,
        billingProvider: data.billingProvider === 'JAMBLE' ? 'JAMBLE' : 'QPSE',
        billingApiBaseUrl: data.billingApiBaseUrl || null,
        billingApiDemoBaseUrl: data.billingApiDemoBaseUrl || null,
        billingApiToken: data.billingApiToken || null,
        billingApiUser: data.billingApiUser || null,
        billingApiPassword: data.billingApiPassword || null,
        esAgenteRetencion: data.esAgenteRetencion || false,
        usaCodigoBarrasManual: data.usaCodigoBarrasManual,
        usarPrecioLoteFefo:
          (data.usarPrecioLoteFefo ?? false) &&
          esPlanPermitidoParaPrecioFefo(planSeleccionado.nombre),
        brand: adminSistemaNegocio
          ? normalizeBrand(adminSistemaNegocio)
          : normalizeBrand(data.brand || 'falconext'),
        producto: productoEmpresa,
        usuarioPse: data.usuarioPse || null,
        contrasenaPse: data.contrasenaPse || null,
        whatsappProvider: data.whatsappProvider || 'PLATFORM',
        whatsappApiToken: data.whatsappApiToken || null,
        whatsappPhoneNumberId: data.whatsappPhoneNumberId || null,
        whatsappBusinessId: data.whatsappBusinessId || null,
        whatsappActivo: data.whatsappActivo ?? true,
        usaDemo: data.usaDemo ?? false,
        usuarios: {
          create: {
            nombre: data.usuario.nombre,
            email: data.usuario.email,
            password: hashed,
            dni: data.usuario.dni,
            celular: data.usuario.celular,
            rol: 'ADMIN_EMPRESA',
            estado: 'ACTIVO',
          },
        },
        clientes: {
          create: {
            nombre: 'CLIENTES VARIOS',
            nroDoc: '10000000',
            estado: 'ACTIVO',
            tipoDocumento: { connect: { codigo: '1' } }, // DNI
          },
        },
        productos: {
          create: [
            {
              codigo: 'DGD',
              descripcion: 'Descuento global',
              unidadMedidaId: unidadMedida.id,
              precioUnitario: 0,
              valorUnitario: 0,
              igvPorcentaje: 0,
              stock: 0,
              tipoAfectacionIGV: '10',
              estado: 'INACTIVO',
            },
            {
              codigo: 'IPM',
              descripcion: 'Interes por mora',
              unidadMedidaId: unidadMedida.id,
              precioUnitario: 0,
              valorUnitario: 0,
              igvPorcentaje: 0,
              stock: 0,
              tipoAfectacionIGV: '10',
              estado: 'INACTIVO',
            },
            {
              codigo: 'PLD',
              descripcion: 'Penalidad',
              unidadMedidaId: unidadMedida.id,
              precioUnitario: 0,
              valorUnitario: 0,
              igvPorcentaje: 0,
              stock: 0,
              tipoAfectacionIGV: '10',
              estado: 'INACTIVO',
            },
          ],
        },
        costoActivacionReseller: planSeleccionado.costo,
      } as any,
      include: {
        plan: true,
        productos: true,
        clientes: true,
        usuarios: { where: { rol: 'ADMIN_EMPRESA' }, take: 1 },
      },
    });

    // Crear/asegurar Sede Principal automáticamente
    await this.sedeService.create(
      {
        nombre: 'Sede Principal',
        direccion: data.direccion,
        codigo: '001',
        esPrincipal: true,
        activo: true,
      },
      empresa.id,
    );
    const sedePrincipal = await this.asegurarSedePrincipalPorDefecto(
      empresa.id,
      data.direccion,
    );

    // Vincular al usuario ADMIN_EMPRESA recién creado con la Sede Principal
    const adminEmpresaId = (empresa as any).usuarios?.[0]?.id;
    if (adminEmpresaId && sedePrincipal?.id) {
      await this.prisma.usuarioSede.upsert({
        where: {
          usuarioId_sedeId: {
            usuarioId: adminEmpresaId,
            sedeId: sedePrincipal.id,
          },
        },
        create: { usuarioId: adminEmpresaId, sedeId: sedePrincipal.id },
        update: {},
      });
    }

    // Log creación
    if (adminUserId) {
      await this.registrarLog(
        empresa.id,
        'CREADA',
        `Plan: ${planSeleccionado.nombre} | Admin: ${data.usuario.email}`,
        adminUserId,
      );
    }

    if (productoEmpresa === 'hotel') {
      try {
        const adminEmpresa = await this.prisma.usuario.findFirst({
          where: { empresaId: empresa.id, rol: 'ADMIN_EMPRESA' },
          select: { id: true },
        });

        const synced = await this.callHotelSync({
          mypeEmpresaId: empresa.id,
          mypeUsuarioId: adminEmpresa?.id,
          hotelName: empresa.nombreComercial || empresa.razonSocial,
          tradeName: empresa.nombreComercial || empresa.razonSocial,
          ruc: empresa.ruc || undefined,
          address: empresa.direccion || undefined,
          city: empresa.distrito || undefined,
          department: empresa.departamento || undefined,
          phone: data.usuario.celular || undefined,
          email: data.usuario.email || undefined,
          adminEmail: data.usuario.email,
          adminPassword: data.usuario.password,
          adminFirstName:
            String(data.usuario.nombre || 'Admin')
              .trim()
              .split(/\s+/)[0] || 'Admin',
          adminLastName:
            String(data.usuario.nombre || '')
              .trim()
              .split(/\s+/)
              .slice(1)
              .join(' ') || 'Administrador',
          adminPhone: data.usuario.celular || undefined,
          isActive: true,
          producto: 'hotel',
          plan: mapHotelPlanName(planSeleccionado.nombre),
          planExpiresAt: expiracion.toISOString(),
        });

        await this.prisma.empresa.update({
          where: { id: empresa.id },
          data: {
            hotelTenantId: synced.tenantId,
            hotelAdminUserId: synced.adminUserId,
            hotelSyncAt: new Date(),
          },
        });
      } catch (error: any) {
        try {
          await this.eliminar(empresa.id);
        } catch {}
        throw new ForbiddenException(
          error?.message || 'No se pudo crear la empresa en Falconext Hotel',
        );
      }
    }

    return empresa;
  }

  async listar(
    params: {
      search?: string;
      page?: number;
      limit?: number;
      sort?:
        | 'id'
        | 'ruc'
        | 'razonSocial'
        | 'fechaActivacion'
        | 'fechaExpiracion';
      order?: 'asc' | 'desc';
      estado?: 'ACTIVO' | 'INACTIVO' | 'TODOS';
      tipoEmpresa?: 'FORMAL' | 'INFORMAL' | '';
      brand?: string;
      producto?: string;
    },
    adminSistemaNegocio?: string | null,
    adminSistemaProducto?: string | null,
  ) {
    const {
      search,
      page = 1,
      limit = 10,
      sort = 'id',
      order = 'desc',
      estado = 'TODOS',
      tipoEmpresa = '',
      brand,
      producto,
    } = params;
    const skip = (page - 1) * limit;

    // Si el admin tiene sistemaNegocio, siempre forzar ese brand (ignora el brand del query)
    const brandFiltro = adminSistemaNegocio
      ? normalizeBrand(adminSistemaNegocio)
      : brand
        ? normalizeBrand(brand)
        : undefined;

    const productoFiltro = adminSistemaProducto
      ? normalizeProducto(adminSistemaProducto)
      : producto
        ? normalizeProducto(producto)
        : undefined;

    let where: any = {};

    // Filtro por estado
    if (estado !== 'TODOS') {
      where.estado = estado;
    }

    // Filtro por tipo de empresa
    if (tipoEmpresa) {
      where.tipoEmpresa = tipoEmpresa;
    }

    // Filtro por brand (forzado por sistemaNegocio o enviado en query)
    if (brandFiltro) {
      where.brand = brandFiltro;
    }

    if (productoFiltro) {
      where.producto = productoFiltro;
    }

    if (search) {
      where = {
        AND: [
          ...(estado !== 'TODOS' ? [{ estado }] : []),
          ...(tipoEmpresa ? [{ tipoEmpresa }] : []),
          ...(brandFiltro ? [{ brand: brandFiltro }] : []),
          ...(productoFiltro ? [{ producto: productoFiltro }] : []),
          {
            OR: [
              { ruc: { contains: search } },
              { razonSocial: { contains: search } },
            ],
          },
        ],
      };
    }

    const [empresas, total] = await Promise.all([
      this.prisma.empresa.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort]: order },
        select: {
          id: true,
          ruc: true,
          razonSocial: true,
          nombreComercial: true,
          tipoEmpresa: true,
          estado: true,
          direccion: true,
          fechaActivacion: true,
          fechaExpiracion: true,
          capacitacion: true,
          altaSunat: true,
          contrato: true,
          bienvenidaRedes: true,
          logo: true,
          slugTienda: true,
          brand: true,
          producto: true,
          usaDemo: true,
          estadoGestion: true,
          billingProvider: true,
          billingApiBaseUrl: true,
          billingApiDemoBaseUrl: true,
          hotelTenantId: true,
          hotelAdminUserId: true,
          hotelSyncAt: true,
          plan: {
            select: {
              nombre: true,
              costo: true,
              descripcion: true,
              maxSedes: true,
              tieneTienda: true,
              esPrueba: true,
              tipoFacturacion: true,
              duracionDias: true,
            },
          },
          rubro: {
            select: {
              id: true,
              nombre: true,
            },
          },
          usuarios: {
            where: { rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
            orderBy: { id: 'asc' },
            select: {
              nombre: true,
              email: true,
              celular: true,
            },
            take: 1,
          },
        },
      }),
      this.prisma.empresa.count({ where }),
    ]);

    // --- Salud / riesgo de fuga: se deriva de la actividad de facturación ---
    // (la señal más confiable de uso real; no hay lastLogin ni updatedAt en Empresa).
    // Umbrales: 🟢 facturó ≤7 días | 🟡 8-14 días | 🔴 >14 días sin facturar.
    const empresaIds = empresas.map((e) => e.id);
    const ahora = new Date();
    const hace7 = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
    const hace30 = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000);

    const saludMap = new Map<
      number,
      { ultimaVenta: Date | null; ventas7: number; ventas30: number }
    >();

    if (empresaIds.length > 0) {
      const [ultimas, count7, count30] = await Promise.all([
        this.prisma.comprobante.groupBy({
          by: ['empresaId'],
          where: { empresaId: { in: empresaIds } },
          _max: { fechaEmision: true },
        }),
        this.prisma.comprobante.groupBy({
          by: ['empresaId'],
          where: { empresaId: { in: empresaIds }, fechaEmision: { gte: hace7 } },
          _count: { _all: true },
        }),
        this.prisma.comprobante.groupBy({
          by: ['empresaId'],
          where: {
            empresaId: { in: empresaIds },
            fechaEmision: { gte: hace30 },
          },
          _count: { _all: true },
        }),
      ]);

      for (const id of empresaIds) {
        saludMap.set(id, { ultimaVenta: null, ventas7: 0, ventas30: 0 });
      }
      for (const u of ultimas) {
        const s = saludMap.get(u.empresaId);
        if (s) s.ultimaVenta = u._max.fechaEmision ?? null;
      }
      for (const c of count7) {
        const s = saludMap.get(c.empresaId);
        if (s) s.ventas7 = c._count._all;
      }
      for (const c of count30) {
        const s = saludMap.get(c.empresaId);
        if (s) s.ventas30 = c._count._all;
      }
    }

    const resolverSalud = (
      e: { id: number; fechaActivacion: Date | null },
    ) => {
      const s = saludMap.get(e.id) ?? {
        ultimaVenta: null,
        ventas7: 0,
        ventas30: 0,
      };
      // Empresas recién activadas que aún no facturan no deben salir en rojo:
      // se cuentan los días desde la última venta, o desde la activación si nunca vendió.
      const referencia = s.ultimaVenta ?? e.fechaActivacion ?? ahora;
      const diasSinVender = Math.floor(
        (ahora.getTime() - new Date(referencia).getTime()) /
          (24 * 60 * 60 * 1000),
      );
      let estado: 'sana' | 'riesgo' | 'critico';
      if (diasSinVender <= 7) estado = 'sana';
      else if (diasSinVender <= 14) estado = 'riesgo';
      else estado = 'critico';
      return {
        estado,
        diasSinVender,
        ultimaVenta: s.ultimaVenta,
        ventas7: s.ventas7,
        ventas30: s.ventas30,
      };
    };

    return {
      empresas: empresas.map((e) => ({
        id: e.id,
        ruc: e.ruc,
        razonSocial: e.razonSocial,
        nombreComercial: e.nombreComercial,
        tipoEmpresa: e.tipoEmpresa,
        direccion: e.direccion,
        estado: e.estado,
        logo: e.logo,
        fechaActivacion: e.fechaActivacion,
        fechaExpiracion: e.fechaExpiracion,
        capacitacion: e.capacitacion,
        altaSunat: e.altaSunat,
        contrato: e.contrato,
        bienvenidaRedes: e.bienvenidaRedes,
        slugTienda: e.slugTienda,
        brand: e.brand,
        producto: e.producto,
        usaDemo: e.usaDemo,
        estadoGestion: e.estadoGestion,
        billingProvider: e.billingProvider,
        ambienteFacturacion: resolveAmbienteFacturacion(e),
        hotelTenantId: e.hotelTenantId,
        hotelAdminUserId: e.hotelAdminUserId,
        hotelSyncAt: e.hotelSyncAt,
        rubro: e.rubro,
        usuarios: e.usuarios,
        plan: {
          nombre: e.plan.nombre,
          costo: e.plan.costo,
          maxSedes: e.plan.maxSedes,
          descripcion: e.plan.descripcion,
          tieneTienda: e.plan.tieneTienda,
          esPrueba: e.plan.esPrueba,
          tipoFacturacion: e.plan.tipoFacturacion,
          duracionDias: e.plan.duracionDias,
        },
        salud: resolverSalud(e),
      })),
      total,
      page,
      limit,
    };
  }

  async actualizar(
    dto: UpdateEmpresaDto,
    adminSistemaNegocio?: string | null,
    adminSistemaProducto?: string | null,
  ) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: dto.id },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    if (
      adminSistemaNegocio &&
      normalizeBrand(empresa.brand) !== normalizeBrand(adminSistemaNegocio)
    ) {
      throw new ForbiddenException('No tienes acceso a esta empresa');
    }
    if (
      adminSistemaProducto &&
      normalizeProducto(empresa.producto) !==
        normalizeProducto(adminSistemaProducto)
    ) {
      throw new ForbiddenException('No tienes acceso a esta empresa');
    }

    try {
      // Preparar datos para actualizar, excluyendo campos undefined
      const updateData: any = {};
      if (dto.ruc !== undefined) updateData.ruc = dto.ruc;
      if (dto.razonSocial !== undefined)
        updateData.razonSocial = dto.razonSocial;
      if (dto.direccion !== undefined) updateData.direccion = dto.direccion;
      if (dto.planId !== undefined) updateData.planId = dto.planId;
      if (dto.tipoEmpresa !== undefined)
        updateData.tipoEmpresa = dto.tipoEmpresa;
      if (dto.regimenTributario !== undefined)
        updateData.regimenTributario = dto.regimenTributario;
      if (dto.departamento !== undefined)
        updateData.departamento = dto.departamento;
      if (dto.provincia !== undefined) updateData.provincia = dto.provincia;
      if (dto.distrito !== undefined) updateData.distrito = dto.distrito;
      if (dto.ubigeo !== undefined) updateData.ubigeo = dto.ubigeo;
      if (dto.rubroId !== undefined) updateData.rubroId = dto.rubroId;
      if (dto.nombreComercial !== undefined)
        updateData.nombreComercial = dto.nombreComercial;
      if (dto.paginaWeb !== undefined) updateData.paginaWeb = dto.paginaWeb;
      if (dto.cotizMostrarEmail !== undefined)
        updateData.cotizMostrarEmail = dto.cotizMostrarEmail;
      if (dto.cotizMostrarCuentas !== undefined)
        updateData.cotizMostrarCuentas = dto.cotizMostrarCuentas;
      if (dto.cotizMostrarRazonSocial !== undefined)
        updateData.cotizMostrarRazonSocial = dto.cotizMostrarRazonSocial;
      if (dto.cotizMostrarDetraccion !== undefined)
        updateData.cotizMostrarDetraccion = dto.cotizMostrarDetraccion;
      if (dto.cotizFormatoConfig !== undefined)
        updateData.cotizFormatoConfig = dto.cotizFormatoConfig as any;
      if (dto.notaVentaFormatoConfig !== undefined)
        updateData.notaVentaFormatoConfig = dto.notaVentaFormatoConfig as any;
      if (dto.facturaFormatoConfig !== undefined)
        updateData.facturaFormatoConfig = dto.facturaFormatoConfig as any;
      if (dto.boletaFormatoConfig !== undefined)
        updateData.boletaFormatoConfig = dto.boletaFormatoConfig as any;
      if (dto.cotizTerminosDefault !== undefined)
        updateData.cotizTerminosDefault = dto.cotizTerminosDefault || null;
      if (dto.cotizObservacionesDefault !== undefined)
        updateData.cotizObservacionesDefault = dto.cotizObservacionesDefault || null;
      if (dto.cuentaDetraccionBN !== undefined)
        updateData.cuentaDetraccionBN = dto.cuentaDetraccionBN;
      if (dto.fechaActivacion !== undefined)
        updateData.fechaActivacion = parseDDMMYYYY(dto.fechaActivacion);
      if (dto.fechaExpiracion !== undefined)
        updateData.fechaExpiracion = parseDDMMYYYY(dto.fechaExpiracion);
      if (dto.capacitacion !== undefined)
        updateData.capacitacion = dto.capacitacion;
      if (dto.altaSunat !== undefined) updateData.altaSunat = dto.altaSunat;
      if (dto.contrato !== undefined) updateData.contrato = dto.contrato;
      if (dto.bienvenidaRedes !== undefined)
        updateData.bienvenidaRedes = dto.bienvenidaRedes;
      if (dto.providerToken !== undefined)
        updateData.providerToken = dto.providerToken;
      if (dto.providerId !== undefined) updateData.providerId = dto.providerId;
      if (dto.billingProvider !== undefined) {
        updateData.billingProvider =
          dto.billingProvider === 'JAMBLE' ? 'JAMBLE' : 'QPSE';
      }
      if (dto.billingApiBaseUrl !== undefined)
        updateData.billingApiBaseUrl = dto.billingApiBaseUrl;
      if (dto.billingApiDemoBaseUrl !== undefined)
        updateData.billingApiDemoBaseUrl = dto.billingApiDemoBaseUrl;
      if (dto.billingApiToken !== undefined)
        updateData.billingApiToken = dto.billingApiToken;
      if (dto.billingApiUser !== undefined)
        updateData.billingApiUser = dto.billingApiUser;
      if (dto.billingApiPassword !== undefined)
        updateData.billingApiPassword = dto.billingApiPassword;
      if (dto.esAgenteRetencion !== undefined)
        updateData.esAgenteRetencion = dto.esAgenteRetencion;
      if (dto.usaCodigoBarrasManual !== undefined)
        updateData.usaCodigoBarrasManual = dto.usaCodigoBarrasManual;
      if (dto.ticketLogoSize !== undefined)
        updateData.ticketLogoSize = dto.ticketLogoSize;
      if (dto.usarPrecioLoteFefo !== undefined)
        updateData.usarPrecioLoteFefo = dto.usarPrecioLoteFefo;
      if (dto.permitirVentaSinStock !== undefined)
        updateData.permitirVentaSinStock = dto.permitirVentaSinStock;
      if (dto.cobranzaCampo !== undefined)
        updateData.cobranzaCampo = dto.cobranzaCampo;
      if (dto.requiereAprobacionGastos !== undefined)
        updateData.requiereAprobacionGastos = dto.requiereAprobacionGastos;
      if (dto.requiereAprobacionCompras !== undefined)
        updateData.requiereAprobacionCompras = dto.requiereAprobacionCompras;
      if (dto.requiereCajaParaEmitir !== undefined)
        updateData.requiereCajaParaEmitir = dto.requiereCajaParaEmitir;
      if (dto.directorTecnico !== undefined)
        updateData.directorTecnico = dto.directorTecnico;
      if (dto.logo !== undefined) updateData.logo = dto.logo;
      if (dto.bancoNombre !== undefined)
        updateData.bancoNombre = dto.bancoNombre;
      if (dto.numeroCuenta !== undefined)
        updateData.numeroCuenta = dto.numeroCuenta;
      if (dto.cci !== undefined) updateData.cci = dto.cci;
      if (dto.monedaCuenta !== undefined)
        updateData.monedaCuenta = dto.monedaCuenta;
      if (dto.yapeNumero !== undefined) updateData.yapeNumero = dto.yapeNumero;
      if (dto.yapeQrUrl !== undefined) updateData.yapeQrUrl = dto.yapeQrUrl;
      if (dto.plinNumero !== undefined) updateData.plinNumero = dto.plinNumero;
      if (dto.plinQrUrl !== undefined) updateData.plinQrUrl = dto.plinQrUrl;
      if (adminSistemaNegocio) {
        updateData.brand = normalizeBrand(adminSistemaNegocio);
      } else if (dto.brand !== undefined) {
        updateData.brand = normalizeBrand(dto.brand);
      }
      if (adminSistemaProducto) {
        updateData.producto = normalizeProducto(adminSistemaProducto);
      } else if (dto.producto !== undefined) {
        updateData.producto = normalizeProducto(dto.producto);
      }
      if (dto.usuarioPse !== undefined) updateData.usuarioPse = dto.usuarioPse;
      if (dto.contrasenaPse !== undefined)
        updateData.contrasenaPse = dto.contrasenaPse;
      if (dto.sunatClientId !== undefined)
        updateData.sunatClientId = dto.sunatClientId || null;
      if (dto.sunatClientSecret !== undefined)
        updateData.sunatClientSecret = dto.sunatClientSecret || null;
      if (dto.whatsappProvider !== undefined)
        updateData.whatsappProvider = dto.whatsappProvider;
      if (dto.whatsappApiToken !== undefined)
        updateData.whatsappApiToken = dto.whatsappApiToken;
      if (dto.shalomEmail !== undefined)
        updateData.shalomEmail = dto.shalomEmail || null;
      // La contraseña solo se actualiza si llega no vacía (vacío = conservar la actual).
      if (dto.shalomPassword !== undefined && dto.shalomPassword.trim() !== '')
        updateData.shalomPassword = dto.shalomPassword;
      if (dto.whatsappPhoneNumberId !== undefined)
        updateData.whatsappPhoneNumberId = dto.whatsappPhoneNumberId;
      if (dto.whatsappBusinessId !== undefined)
        updateData.whatsappBusinessId = dto.whatsappBusinessId;
      if (dto.whatsappActivo !== undefined)
        updateData.whatsappActivo = dto.whatsappActivo;
      if (dto.usaDemo !== undefined) updateData.usaDemo = dto.usaDemo;

      const productoFinal = adminSistemaProducto
        ? normalizeProducto(adminSistemaProducto)
        : dto.producto !== undefined
          ? normalizeProducto(dto.producto)
          : normalizeProducto(empresa.producto);
      const planIdFinal =
        dto.planId !== undefined ? dto.planId : empresa.planId;
      if (dto.planId !== undefined || dto.producto !== undefined) {
        const planFinal = await this.prisma.plan.findUnique({
          where: { id: planIdFinal },
          select: { id: true, nombre: true, producto: true },
        });
        if (!planFinal)
          throw new ForbiddenException('Plan seleccionado no encontrado');
        if (normalizeProducto(planFinal.producto) !== productoFinal) {
          throw new ForbiddenException(
            'El plan seleccionado no pertenece al producto de la empresa',
          );
        }
      }

      if (dto.usarPrecioLoteFefo === true) {
        const planParaValidar = await this.prisma.plan.findUnique({
          where: { id: planIdFinal },
          select: { nombre: true },
        });
        if (!esPlanPermitidoParaPrecioFefo(planParaValidar?.nombre)) {
          throw new ForbiddenException(
            'Esta opción está disponible solo para planes Negocio y Corporativo',
          );
        }
      }

      // Actualizar datos de empresa
      const empresaActualizada = await this.prisma.empresa.update({
        where: { id: dto.id },
        data: updateData,
      });

      if (dto.usuario) {
        const adminUser = await this.prisma.usuario.findFirst({
          where: {
            empresaId: dto.id,
            rol: 'ADMIN_EMPRESA',
          },
          orderBy: { id: 'asc' },
        });

        const userData: any = {};
        if (dto.usuario.nombre !== undefined)
          userData.nombre = dto.usuario.nombre;
        if (dto.usuario.email !== undefined) userData.email = dto.usuario.email;
        if (dto.usuario.dni !== undefined) userData.dni = dto.usuario.dni;
        if (dto.usuario.celular !== undefined)
          userData.celular = dto.usuario.celular;
        if (dto.usuario.password && dto.usuario.password.length > 0) {
          userData.password = await bcrypt.hash(dto.usuario.password, 10);
        }

        if (adminUser) {
          if (Object.keys(userData).length > 0) {
            await this.prisma.usuario.update({
              where: { id: adminUser.id },
              data: userData,
            });
          }
        } else if (dto.usuario.email) {
          await this.prisma.usuario.create({
            data: {
              nombre: dto.usuario.nombre || 'Administrador',
              email: dto.usuario.email,
              dni: dto.usuario.dni || '00000000',
              celular: dto.usuario.celular || '999999999',
              password:
                userData.password || (await bcrypt.hash('admin123', 10)),
              rol: 'ADMIN_EMPRESA',
              estado: 'ACTIVO',
              empresaId: dto.id,
              permisos: '["*"]',
            },
          });
        }
      }

      if (productoFinal === 'hotel') {
        await this.sincronizarEmpresaHotel(dto.id, dto.usuario?.password);
      } else if (
        empresaActualizada.hotelTenantId ||
        empresaActualizada.hotelAdminUserId
      ) {
        await this.prisma.empresa.update({
          where: { id: dto.id },
          data: {
            hotelTenantId: null,
            hotelAdminUserId: null,
            hotelSyncAt: null,
          },
        });
      }

      return this.obtenerPorId(dto.id);
    } catch (error: any) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const campo = Array.isArray(error.meta?.target)
          ? (error.meta.target as string[])[0]
          : 'valor único';
        throw new ForbiddenException(`Este ${campo} ya está en uso`);
      }
      throw error;
    }
  }

  async cambiarEstado(
    id: number,
    estado: 'ACTIVO' | 'INACTIVO',
    userId?: number,
  ) {
    const empresa = await this.prisma.empresa.findUnique({ where: { id } });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    const result = await this.prisma.empresa.update({
      where: { id },
      data: { estado },
    });
    if (normalizeProducto(empresa.producto) === 'hotel') {
      await this.sincronizarEmpresaHotel(id);
    }
    if (userId) {
      await this.registrarLog(
        id,
        estado === 'ACTIVO' ? 'ACTIVADA' : 'DESACTIVADA',
        null,
        userId,
      );
    }
    return result;
  }

  async eliminar(id: number) {
    const empresa = await this.prisma.empresa.findUnique({ where: { id } });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    // Eliminar en orden para respetar las relaciones FK
    try {
      // 1. Eliminar detalles de comprobantes
      await this.prisma.detalleComprobante.deleteMany({
        where: { comprobante: { empresaId: id } },
      });

      // 2. Eliminar leyendas de comprobantes
      await this.prisma.leyenda.deleteMany({
        where: { comprobante: { empresaId: id } },
      });

      // 3. Eliminar pagos
      await this.prisma.pago.deleteMany({
        where: { empresaId: id },
      });

      // 4. Eliminar comprobantes
      await this.prisma.comprobante.deleteMany({
        where: { empresaId: id },
      });

      // 5. Eliminar movimientos de kardex (referencia productos)
      await this.prisma.movimientoKardex.deleteMany({
        where: { producto: { empresaId: id } },
      });

      // 6. Eliminar items de pedidos tienda (referencia productos)
      await this.prisma.itemPedidoTienda.deleteMany({
        where: { producto: { empresaId: id } },
      });

      // 7. Eliminar pedidos tienda
      await this.prisma.pedidoTienda.deleteMany({
        where: { empresaId: id },
      });

      // 8. Eliminar productos
      await this.prisma.producto.deleteMany({
        where: { empresaId: id },
      });

      // 9. Eliminar clientes
      await this.prisma.cliente.deleteMany({
        where: { empresaId: id },
      });

      // 10. Eliminar refresh tokens (referencia usuarios)
      await this.prisma.refreshToken.deleteMany({
        where: { usuario: { empresaId: id } },
      });

      // 11. Eliminar movimientos de caja (referencia usuarios)
      await this.prisma.movimientoCaja.deleteMany({
        where: { usuario: { empresaId: id } },
      });

      // 12. Eliminar usuarios
      await this.prisma.usuario.deleteMany({
        where: { empresaId: id },
      });

      // 13. Eliminar categorías
      await this.prisma.categoria.deleteMany({
        where: { empresaId: id },
      });

      // 14. Finalmente eliminar la empresa
      return this.prisma.empresa.delete({ where: { id } });
    } catch (error: any) {
      throw new ForbiddenException(
        `Error al eliminar empresa: ${error.message}. Puede tener datos relacionados que deben eliminarse primero.`,
      );
    }
  }


  /**
   * Exporta el listado de empresas (con los mismos filtros del listado) en
   * Excel o PDF imprimible — para el admin de sistema.
   */
  async exportarListado(
    params: {
      search?: string;
      estado?: 'ACTIVO' | 'INACTIVO' | 'TODOS';
      tipoEmpresa?: 'FORMAL' | 'INFORMAL' | '';
      brand?: string;
      producto?: string;
      formato?: 'pdf' | 'excel';
    },
    adminSistemaNegocio?: string | null,
    adminSistemaProducto?: string | null,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const { search, estado = 'TODOS', tipoEmpresa = '', formato = 'excel' } = params;

    const brandFiltro = adminSistemaNegocio
      ? normalizeBrand(adminSistemaNegocio)
      : params.brand
        ? normalizeBrand(params.brand)
        : undefined;
    const productoFiltro = adminSistemaProducto
      ? normalizeProducto(adminSistemaProducto)
      : params.producto
        ? normalizeProducto(params.producto)
        : undefined;

    const filtros: any[] = [
      ...(estado !== 'TODOS' ? [{ estado }] : []),
      ...(tipoEmpresa ? [{ tipoEmpresa }] : []),
      ...(brandFiltro ? [{ brand: brandFiltro }] : []),
      ...(productoFiltro ? [{ producto: productoFiltro }] : []),
      ...(search
        ? [{ OR: [{ ruc: { contains: search } }, { razonSocial: { contains: search } }] }]
        : []),
    ];
    const where = filtros.length ? { AND: filtros } : {};

    const empresasRaw = await this.prisma.empresa.findMany({
      where,
      orderBy: [{ estado: 'asc' }, { fechaExpiracion: 'asc' }],
      select: {
        ruc: true,
        razonSocial: true,
        nombreComercial: true,
        estado: true,
        usaDemo: true,
        fechaActivacion: true,
        fechaExpiracion: true,
        brand: true,
        plan: { select: { nombre: true, esPrueba: true } },
        rubro: { select: { nombre: true } },
      },
    });

    // El informe es de clientes REALES: fuera demos (ambiente demo, plan de
    // prueba o razón social "DEMO") y las empresas internas/de prueba del equipo.
    const RUCS_EXCLUIDOS_EXPORT = ['20524076307', '10479465750'];
    const empresas = empresasRaw.filter(
      (e) =>
        !e.usaDemo &&
        !e.plan?.esPrueba &&
        !RUCS_EXCLUIDOS_EXPORT.includes(e.ruc) &&
        !String(e.razonSocial ?? '').toUpperCase().includes('DEMO'),
    );

    if (empresas.length === 0) {
      throw new NotFoundException('No se encontraron empresas con los filtros seleccionados');
    }

    const fmtFecha = (d?: Date | null) =>
      d
        ? new Date(d).toLocaleDateString('es-PE', {
            timeZone: 'America/Lima',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })
        : '';
    const hoy = Date.now();
    const venceEn = (d?: Date | null) => {
      if (!d) return '';
      const dias = Math.ceil((new Date(d).getTime() - hoy) / 86_400_000);
      return dias >= 0 ? `${dias} días` : `Vencida hace ${Math.abs(dias)} días`;
    };

    const mesInicio = (d?: Date | null) => {
      if (!d) return '';
      const txt = new Date(d).toLocaleDateString('es-PE', {
        timeZone: 'America/Lima',
        month: 'short',
        year: 'numeric',
      });
      return txt.charAt(0).toUpperCase() + txt.slice(1);
    };

    const filas = empresas.map((e) => ({
      ruc: e.ruc,
      razonSocial: e.razonSocial,
      comercial: e.nombreComercial ?? '',
      ambiente: e.usaDemo ? 'Demo' : 'Producción',
      rubro: e.rubro?.nombre ?? '',
      plan: e.plan?.nombre ?? '',
      inicio: mesInicio(e.fechaActivacion),
      activacion: fmtFecha(e.fechaActivacion),
      expiracion: fmtFecha(e.fechaExpiracion),
      vence: venceEn(e.fechaExpiracion),
      estado: e.estado === 'ACTIVO' ? 'Activo' : 'Inactivo',
    }));
    const activas = filas.filter((f) => f.estado === 'Activo').length;
    const genFecha = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' });

    if (formato === 'excel') {
      const headers = ['RUC', 'Razón Social', 'Nombre Comercial', 'Ambiente', 'Rubro', 'Plan', 'Mes de Inicio', 'Activación', 'Expiración', 'Vence en', 'Estado'];
      const aoa = [
        [`Empresas registradas — ${filas.length} en total (${activas} activas) · Generado: ${genFecha}`],
        [],
        headers,
        ...filas.map((f) => [f.ruc, f.razonSocial, f.comercial, f.ambiente, f.rubro, f.plan, f.inicio, f.activacion, f.expiracion, f.vence, f.estado]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 13 }, { wch: 38 }, { wch: 24 }, { wch: 11 }, { wch: 22 }, { wch: 18 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 10 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Empresas');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      return {
        buffer,
        filename: 'empresas.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }

    const esc = (v: string) =>
      String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const filasHtml = filas
      .map(
        (f) => `
        <tr${f.estado === 'Inactivo' ? ' style="color:#9ca3af;"' : ''}>
          <td>${esc(f.ruc)}</td>
          <td><strong>${esc(f.razonSocial)}</strong>${f.comercial ? `<br/><span class="sub">${esc(f.comercial)}</span>` : ''}</td>
          <td>${esc(f.ambiente)}</td>
          <td>${esc(f.rubro)}</td>
          <td>${esc(f.plan)}</td>
          <td>${esc(f.inicio)}</td>
          <td>${esc(f.expiracion)}</td>
          <td>${esc(f.vence)}</td>
          <td>${esc(f.estado)}</td>
        </tr>`,
      )
      .join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { font-family: Arial, Helvetica, sans-serif; box-sizing: border-box; }
      body { margin: 24px; color: #111827; font-size: 10.5px; }
      h1 { font-size: 16px; margin: 0 0 2px; }
      .sub { color: #6b7280; font-size: 9.5px; }
      .meta { color: #6b7280; margin-bottom: 14px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f3f4f6; text-align: left; padding: 6px 8px; border-bottom: 2px solid #d1d5db; font-size: 9.5px; text-transform: uppercase; }
      td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    </style></head><body>
      <h1>Empresas registradas</h1>
      <div class="meta">${filas.length} empresa(s) · ${activas} activas · Generado: ${esc(genFecha)}</div>
      <table>
        <thead><tr><th>RUC</th><th>Razón Social</th><th>Ambiente</th><th>Rubro</th><th>Plan</th><th>Mes de Inicio</th><th>Expiración</th><th>Vence en</th><th>Estado</th></tr></thead>
        <tbody>${filasHtml}</tbody>
      </table>
    </body></html>`;

    const buffer = await this.pdfGenerator.generarPdfDesdeHtml(html);
    return { buffer, filename: 'empresas.pdf', contentType: 'application/pdf' };
  }

  async listarSeries(
    empresaId: number,
    adminSistemaNegocio?: string | null,
    adminSistemaProducto?: string | null,
  ) {
    await this.asegurarAccesoEmpresaSistema(
      empresaId,
      adminSistemaNegocio,
      adminSistemaProducto,
    );

    return this.prisma.empresaSerie.findMany({
      where: {
        empresaId,
        tipoDoc: { in: [...EMPRESA_SERIE_TIPOS_PERMITIDOS] },
      },
      orderBy: [{ tipoDoc: 'asc' }, { id: 'asc' }],
    });
  }

  async guardarSeries(
    empresaId: number,
    series: EmpresaSerieInput[],
    userId?: number,
    adminSistemaNegocio?: string | null,
    adminSistemaProducto?: string | null,
  ) {
    await this.asegurarAccesoEmpresaSistema(
      empresaId,
      adminSistemaNegocio,
      adminSistemaProducto,
    );
    const normalizadas = this.normalizarSeriesEmpresa(series);

    await this.prisma.$transaction(async (tx) => {
      await tx.empresaSerie.deleteMany({
        where: {
          empresaId,
          tipoDoc: { in: [...EMPRESA_SERIE_TIPOS_PERMITIDOS] },
        },
      });

      if (normalizadas.length > 0) {
        await tx.empresaSerie.createMany({
          data: normalizadas.map((serie) => ({
            empresaId,
            tipoDoc: serie.tipoDoc,
            serie: serie.serie,
            correlativo: serie.correlativo,
            activo: serie.activo,
          })),
        });
      }
    });

    if (userId) {
      await this.registrarLog(
        empresaId,
        'SERIES_SUNAT_ACTUALIZADAS',
        JSON.stringify(normalizadas),
        userId,
      );
    }

    return this.listarSeries(
      empresaId,
      adminSistemaNegocio,
      adminSistemaProducto,
    );
  }

  async obtenerPorId(id: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id },
      include: {
        plan: true,
        rubro: {
          include: {
            features: {
              select: {
                featureKey: true,
                enabledByDefault: true,
              },
            },
          },
        },
        usuarios: {
          where: { rol: { in: ['ADMIN_EMPRESA', 'ADMIN_SISTEMA'] } },
          select: {
            id: true,
            nombre: true,
            email: true,
            celular: true,
            dni: true,
            rol: true,
            estado: true,
          },
          take: 1,
        },
        series: {
          where: {
            tipoDoc: { in: [...EMPRESA_SERIE_TIPOS_PERMITIDOS] },
          },
          orderBy: [{ tipoDoc: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    if ((empresa as any).rubro?.features) {
      (empresa as any).rubro.features = Object.fromEntries(
        (empresa as any).rubro.features.map((feature: any) => [
          feature.featureKey,
          feature.enabledByDefault,
        ]),
      );
    }
    return empresa;
  }

  async obtenerMiEmpresa(empresaId: number) {
    if (!empresaId)
      throw new ForbiddenException(
        'No se pudo determinar la empresa del usuario',
      );
    const empresa = await this.obtenerPorId(empresaId);
    return empresa;
  }

  async sincronizarHotelDesdeMype(
    empresaId: number,
    adminSistemaNegocio?: string | null,
    adminSistemaProducto?: string | null,
    adminPassword?: string,
  ) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    if (
      adminSistemaNegocio &&
      normalizeBrand(empresa.brand) !== normalizeBrand(adminSistemaNegocio)
    ) {
      throw new ForbiddenException('No tienes acceso a esta empresa');
    }
    if (
      adminSistemaProducto &&
      normalizeProducto(empresa.producto) !==
        normalizeProducto(adminSistemaProducto)
    ) {
      throw new ForbiddenException('No tienes acceso a esta empresa');
    }

    const synced = await this.sincronizarEmpresaHotel(empresaId, adminPassword);
    return {
      ok: true,
      empresaId,
      hotelTenantId: synced.tenantId,
      hotelAdminUserId: synced.adminUserId,
    };
  }

  async consultarRuc(ruc: string) {
    if (!ruc || ruc.length !== 11) {
      throw new ForbiddenException('El RUC debe tener 11 dígitos');
    }

    try {
      const token = process.env.RENIEC_TOKEN;
      const url = 'https://apiperu.dev/api/ruc';
      const body = { ruc };

      const response = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      return response.data?.data;
    } catch (error: any) {
      throw new ForbiddenException(
        'Error al consultar RUC: ' +
          (error.response?.data?.message || error.message),
      );
    }
  }

  async obtenerEmpresasProximasVencer(diasAntes: number = 7) {
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() + diasAntes);

    const empresas = await this.prisma.empresa.findMany({
      where: {
        estado: 'ACTIVO',
        fechaExpiracion: {
          lte: fechaLimite,
          gte: new Date(), // Solo futuras, no vencidas
        },
      },
      include: {
        plan: {
          select: {
            nombre: true,
            costo: true,
            tipoFacturacion: true,
          },
        },
      },
      orderBy: {
        fechaExpiracion: 'asc',
      },
    });

    return empresas.map((empresa) => ({
      id: empresa.id,
      ruc: empresa.ruc,
      razonSocial: empresa.razonSocial,
      nombreComercial: empresa.nombreComercial,
      fechaExpiracion: empresa.fechaExpiracion,
      diasRestantes: Math.ceil(
        (empresa.fechaExpiracion.getTime() - new Date().getTime()) /
          (1000 * 60 * 60 * 24),
      ),
      plan: empresa.plan,
    }));
  }

  // ── NOTAS INTERNAS ─────────────────────────────────────────────────────────

  private async resolverAutor(
    userId: number,
  ): Promise<{ nombre: string; email: string }> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: userId },
      select: { nombre: true, email: true },
    });
    return {
      nombre: usuario?.nombre ?? 'Admin',
      email: usuario?.email ?? 'sistema',
    };
  }

  async listarNotas(empresaId: number) {
    return this.prisma.notaEmpresa.findMany({
      where: { empresaId },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async crearNota(
    empresaId: number,
    contenido: string,
    userId: number,
    notificar = false,
  ) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    const autor = await this.resolverAutor(userId);
    const nota = await this.prisma.notaEmpresa.create({
      data: {
        empresaId,
        contenido,
        autorNombre: autor.nombre,
        autorEmail: autor.email,
        notificado: notificar,
      },
    });
    if (notificar) {
      this.enviarEmailNota(empresa, contenido, autor.nombre).catch(() => {});
    }
    return nota;
  }

  private async enviarEmailNota(
    empresa: any,
    contenido: string,
    autorNombre: string,
  ) {
    const admins = await this.prisma.usuario.findMany({
      where: { empresaId: empresa.id, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
      select: { email: true },
    });
    const empresaNombre = empresa.nombreComercial || empresa.razonSocial;
    const appName = empresa.brand === 'krezka' ? 'Krezka' : 'Falconext';
    for (const admin of admins) {
      await this.enviarEmailPlantilla(admin.email, {
        tipo: 'NOTA',
        empresaNombre,
        mensajeCustom: contenido,
        adminNombre: autorNombre,
        autorNombre,
        appName,
      }).catch(() => {});
    }
  }

  // ── EMAIL PLANTILLAS ───────────────────────────────────────────────────────

  async enviarEmailTemplate(
    empresaId: number,
    tipo: 'BIENVENIDA' | 'AGRADECIMIENTO' | 'RECORDATORIO' | 'PROMOCION',
    opts: {
      mensajeCustom?: string;
      tituloPromo?: string;
      etiqueta?: string;
      pagoConcepto?: string;
      pagoMonto?: string;
      pagoReferencia?: string;
      costoInstalacion?: string;
    } = {},
  ) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: {
        plan: {
          select: {
            nombre: true,
            costo: true,
            duracionDias: true,
            tipoFacturacion: true,
            tieneTienda: true,
            tieneTicketera: true,
            tieneGestionLotes: true,
            maxSedes: true,
            limiteUsuarios: true,
          },
        },
      },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    if (tipo === 'RECORDATORIO' && empresa.estado !== 'ACTIVO') {
      throw new BadRequestException(
        'Solo se envían recordatorios a empresas activas',
      );
    }

    const admins = await this.prisma.usuario.findMany({
      where: { empresaId, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
      select: { email: true, nombre: true },
    });
    if (!admins.length)
      throw new NotFoundException(
        'La empresa no tiene administradores activos',
      );

    const empresaNombre = empresa.nombreComercial || empresa.razonSocial;
    const appName = empresa.brand === 'krezka' ? 'Krezka' : 'Falconext';
    const planNombre = (empresa.plan as any)?.nombre ?? '';
    const fechaExp = empresa.fechaExpiracion;
    const fechaExpiracion = formatDateEsPeDateOnly(fechaExp);
    const fechaActivacion = formatDateEsPeDateOnly(empresa.fechaActivacion);
    const diasRestantes = getDaysRemainingDateOnly(fechaExp);
    const accessUrl = resolveAppAccessUrl(empresa);
    const planCosto =
      (empresa.plan as any)?.costo != null
        ? `S/ ${Number((empresa.plan as any).costo).toFixed(2)}`
        : '';
    const planFeatures = [
      (empresa.plan as any)?.maxSedes
        ? `Hasta ${(empresa.plan as any).maxSedes} sede${Number((empresa.plan as any).maxSedes) === 1 ? '' : 's'}`
        : '',
      (empresa.plan as any)?.limiteUsuarios
        ? `Hasta ${(empresa.plan as any).limiteUsuarios} usuario${Number((empresa.plan as any).limiteUsuarios) === 1 ? '' : 's'}`
        : '',
      (empresa.plan as any)?.tieneTienda ? 'Tienda virtual incluida' : '',
      (empresa.plan as any)?.tieneTicketera ? 'Compatible con ticketera' : '',
      (empresa.plan as any)?.tieneGestionLotes ? 'Gestión de lotes' : '',
    ].filter(Boolean);

    // Normaliza un monto ingresado libremente a formato Soles "S/ X.XX"
    const formatSoles = (valor?: string): string | undefined => {
      if (!valor) return undefined;
      let limpio = String(valor).replace(/[^0-9.,]/g, '');
      // Si trae coma y punto, la coma es separador de miles; si solo coma, es decimal
      limpio =
        limpio.includes(',') && limpio.includes('.')
          ? limpio.replace(/,/g, '')
          : limpio.replace(',', '.');
      const num = parseFloat(limpio);
      return Number.isNaN(num) ? valor : `S/ ${num.toFixed(2)}`;
    };
    const costoInstalacion = formatSoles(opts.costoInstalacion);

    let enviados = 0;
    for (const admin of admins) {
      await this.enviarEmailPlantilla(admin.email, {
        tipo,
        empresaNombre,
        adminNombre: admin.nombre,
        mensajeCustom: opts.mensajeCustom,
        tituloPromo: opts.tituloPromo,
        etiqueta: opts.etiqueta,
        fechaExpiracion,
        fechaActivacion,
        diasRestantes,
        planNombre,
        planCosto,
        planFeatures,
        adminEmail: admin.email,
        accessUrl,
        pagoConcepto: opts.pagoConcepto,
        pagoMonto: opts.pagoMonto,
        pagoReferencia: opts.pagoReferencia,
        costoInstalacion,
        appName,
      });
      enviados++;
    }
    return { enviados };
  }

  async enviarWhatsappRecordatorio(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { plan: { select: { nombre: true } } },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    if (empresa.estado !== 'ACTIVO') {
      throw new BadRequestException(
        'Solo se envían recordatorios a empresas activas',
      );
    }

    const admins = await this.prisma.usuario.findMany({
      where: {
        empresaId,
        rol: 'ADMIN_EMPRESA',
        estado: 'ACTIVO',
      },
      select: { nombre: true, celular: true },
    });

    const adminsConCelular = admins.filter(
      (admin) => String(admin.celular ?? '').replace(/\D/g, '').length >= 9,
    );
    if (!adminsConCelular.length) {
      throw new NotFoundException(
        'La empresa no tiene administradores activos con celular',
      );
    }

    const empresaNombre = empresa.nombreComercial || empresa.razonSocial;
    const appName = empresa.brand === 'krezka' ? 'Krezka' : 'Falconext';
    const planNombre = (empresa.plan as any)?.nombre ?? '';
    const fechaExpiracion = formatDateEsPeDateOnly(empresa.fechaExpiracion);
    const diasRestantes = getDaysRemainingDateOnly(empresa.fechaExpiracion);
    const estadoVencimiento = formatDaysLabel(diasRestantes);
    const errores: string[] = [];
    let enviados = 0;

    for (const admin of adminsConCelular) {
      const mensaje = [
        `Hola ${admin.nombre || 'equipo'}, te recordamos que la suscripción de ${empresaNombre} en ${appName} ${estadoVencimiento}.`,
        planNombre ? `Plan actual: ${planNombre}.` : '',
        fechaExpiracion ? `Fecha de vencimiento: ${fechaExpiracion}.` : '',
        'Renueva a tiempo para mantener activo tu acceso, facturación, inventario y tienda virtual.',
      ]
        .filter(Boolean)
        .join('\n');

      const result = await this.whatsappService.enviarTexto(
        admin.celular,
        mensaje,
      );
      if (result.success) {
        enviados++;
      } else {
        errores.push(result.error || `No se pudo enviar a ${admin.celular}`);
      }
    }

    if (enviados === 0) {
      throw new BadRequestException(
        errores[0] || 'No se pudo enviar el recordatorio por WhatsApp',
      );
    }

    return { enviados, errores };
  }

  private async enviarEmailPlantilla(
    destinatario: string,
    opts: {
      tipo: string;
      empresaNombre: string;
      adminNombre: string;
      mensajeCustom?: string;
      tituloPromo?: string;
      etiqueta?: string;
      fechaExpiracion?: string;
      fechaActivacion?: string;
      diasRestantes?: number;
      planNombre?: string;
      planCosto?: string;
      planFeatures?: string[];
      adminEmail?: string;
      accessUrl?: string;
      pagoConcepto?: string;
      pagoMonto?: string;
      pagoReferencia?: string;
      costoInstalacion?: string;
      autorNombre?: string;
      appName: string;
    },
  ) {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;

    const { Resend } = await import('resend');
    const { render } = await import('@react-email/render');
    const resend = new Resend(resendKey);
    const fromEmail =
      process.env.RESEND_FROM_EMAIL ||
      process.env.MAIL_FROM ||
      'noreply@falconext.pe';

    const {
      tipo,
      empresaNombre,
      adminNombre,
      mensajeCustom,
      tituloPromo,
      etiqueta,
      fechaExpiracion,
      fechaActivacion,
      diasRestantes = 7,
      planNombre,
      planCosto,
      planFeatures,
      adminEmail,
      accessUrl,
      pagoConcepto,
      pagoMonto,
      pagoReferencia,
      costoInstalacion,
      autorNombre,
      appName,
    } = opts;

    let asunto = '';
    let html = '';

    if (tipo === 'BIENVENIDA') {
      const { BienvenidaEmail } = await import('./emails/BienvenidaEmail.js');
      asunto = `¡Bienvenido/a a ${appName}! — ${empresaNombre}`;
      html = await render(
        (BienvenidaEmail as any)({
          empresaNombre,
          adminNombre,
          adminEmail,
          planNombre,
          planCosto,
          planFeatures,
          fechaActivacion,
          fechaExpiracion,
          accessUrl,
          appName,
          costoInstalacion,
          mensajeExtra: mensajeCustom,
        }),
      );
    } else if (tipo === 'AGRADECIMIENTO') {
      const { AgradecimientoEmail } = await import(
        './emails/AgradecimientoEmail.js'
      );
      asunto = `¡Gracias por tu pago puntual! — ${empresaNombre}`;
      html = await render(
        (AgradecimientoEmail as any)({
          empresaNombre,
          adminNombre,
          planNombre,
          planCosto,
          fechaExpiracion,
          pagoConcepto,
          pagoMonto,
          pagoReferencia,
          appName,
          mensajeExtra: mensajeCustom,
        }),
      );
    } else if (tipo === 'RECORDATORIO') {
      const { RecordatorioEmail } = await import(
        './emails/RecordatorioEmail.js'
      );
      asunto = buildReminderSubject(diasRestantes, empresaNombre);
      html = await render(
        (RecordatorioEmail as any)({
          empresaNombre,
          adminNombre,
          diasRestantes,
          fechaExpiracion,
          planNombre,
          appName,
          mensajeExtra: mensajeCustom,
        }),
      );
    } else if (tipo === 'PROMOCION') {
      const { PromocionEmail } = await import('./emails/PromocionEmail.js');
      asunto = `🎁 ${tituloPromo || 'Oferta especial'} — ${empresaNombre}`;
      html = await render(
        (PromocionEmail as any)({
          empresaNombre,
          adminNombre,
          tituloPromo: tituloPromo || 'Oferta especial',
          mensajePromo: mensajeCustom || '',
          appName,
          etiqueta,
        }),
      );
    } else {
      // NOTA ad-hoc
      const { BienvenidaEmail } = await import('./emails/BienvenidaEmail.js');
      asunto = `Mensaje de ${appName} — ${empresaNombre}`;
      // Para notas usamos HTML simple sin React Email
      html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
  <tr><td align="center">
    <table width="560" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.06)">
      <tr><td style="background:#6366f1;padding:28px 32px;text-align:center">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">📩 Mensaje de ${appName}</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">${empresaNombre}</p>
      </td></tr>
      <tr><td style="padding:28px 32px;color:#374151;font-size:15px;line-height:1.7">
        <p style="padding:16px;background:#f8fafc;border-left:4px solid #6366f1;border-radius:0 10px 10px 0;margin:0">${(mensajeCustom ?? '').replace(/\n/g, '<br/>')}</p>
        ${autorNombre ? `<p style="font-size:12px;color:#94a3b8;margin-top:16px">Enviado por ${autorNombre}</p>` : ''}
      </td></tr>
      <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;color:#94a3b8;font-size:12px">${appName}</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
    }

    const { error } = await resend.emails.send({
      from: `${appName} <${fromEmail}>`,
      to: destinatario,
      subject: asunto,
      html,
    });
    if (error) throw new Error(error.message);
  }

  async eliminarNota(notaId: number) {
    const nota = await this.prisma.notaEmpresa.findUnique({
      where: { id: notaId },
    });
    if (!nota) throw new NotFoundException('Nota no encontrada');
    return this.prisma.notaEmpresa.delete({ where: { id: notaId } });
  }

  // ── HISTORIAL / AUDITORÍA ─────────────────────────────────────────────────

  async listarLog(empresaId: number) {
    return this.prisma.empresaLog.findMany({
      where: { empresaId },
      orderBy: { creadoEn: 'desc' },
      take: 100,
    });
  }

  // ── Postventa / retención: bitácora de seguimiento y estado de gestión ──────

  private readonly ESTADOS_GESTION = [
    'POR_CONTACTAR',
    'CONTACTADA',
    'EN_NEGOCIACION',
    'RECUPERADA',
    'PERDIDA',
  ];

  async listarSeguimientos(empresaId: number) {
    return this.prisma.seguimientoEmpresa.findMany({
      where: { empresaId },
      orderBy: { creadoEn: 'desc' },
      take: 100,
    });
  }

  async crearSeguimiento(
    empresaId: number,
    dto: { nota?: string; canal?: string; estadoGestion?: string },
    userId: number,
  ) {
    const nota = (dto.nota ?? '').trim();
    if (!nota) {
      throw new BadRequestException('La nota de seguimiento no puede estar vacía');
    }
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true },
    });
    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }
    const estadoGestion =
      dto.estadoGestion && this.ESTADOS_GESTION.includes(dto.estadoGestion)
        ? dto.estadoGestion
        : null;
    const autor = await this.resolverAutor(userId);

    const [seguimiento] = await this.prisma.$transaction([
      this.prisma.seguimientoEmpresa.create({
        data: {
          empresaId,
          nota,
          canal: dto.canal ?? null,
          estadoGestion,
          autorNombre: autor.nombre,
          autorEmail: autor.email,
        },
      }),
      // Si el seguimiento fija un estado, se refleja como estado actual de la empresa.
      ...(estadoGestion
        ? [
            this.prisma.empresa.update({
              where: { id: empresaId },
              data: { estadoGestion },
            }),
          ]
        : []),
    ]);
    return seguimiento;
  }

  async actualizarGestion(
    empresaId: number,
    dto: { estadoGestion: string | null; nota?: string },
    userId: number,
  ) {
    const estadoGestion =
      dto.estadoGestion && this.ESTADOS_GESTION.includes(dto.estadoGestion)
        ? dto.estadoGestion
        : null;
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true },
    });
    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }
    const autor = await this.resolverAutor(userId);
    const nota = (dto.nota ?? '').trim();

    await this.prisma.$transaction([
      this.prisma.empresa.update({
        where: { id: empresaId },
        data: { estadoGestion },
      }),
      // Deja rastro del cambio de estado en la bitácora.
      this.prisma.seguimientoEmpresa.create({
        data: {
          empresaId,
          nota: nota || `Estado de gestión cambiado a ${estadoGestion ?? 'Sin gestión'}`,
          canal: null,
          estadoGestion,
          autorNombre: autor.nombre,
          autorEmail: autor.email,
        },
      }),
    ]);
    return { estadoGestion };
  }

  async registrarLog(
    empresaId: number,
    accion: string,
    detalle: string | null,
    userId: number,
  ) {
    try {
      const autor = await this.resolverAutor(userId);
      await this.prisma.empresaLog.create({
        data: {
          empresaId,
          accion,
          detalle,
          autorNombre: autor.nombre,
          autorEmail: autor.email,
        },
      });
    } catch {
      /* nunca debe romper el flujo principal */
    }
  }

  // ─── Cuentas Bancarias ────────────────────────────────────────────────────────

  async listarCuentasBancarias(empresaId: number) {
    return this.prisma.cuentaBancaria.findMany({
      where: { empresaId },
      orderBy: { creadoEn: 'asc' },
    });
  }

  /**
   * Saldo por cuenta bancaria = ingresos − egresos, derivado de:
   *   + Pago (cobros de comprobantes; Yape/Plin abonan aquí automáticamente)
   *   + MovimientoCaja CIERRE depositado (efectivo de caja depositado al banco)
   *   − PagoCompra (pagos a proveedores por banco)
   *   − GastoOperativo (gastos pagados por banco)
   * No hay un campo `saldo` persistido: se calcula al vuelo (una query agregada
   * por fuente). Es un saldo operativo simple, no un libro contable.
   */
  async saldosCuentasBancarias(empresaId: number) {
    const cuentas = await this.prisma.cuentaBancaria.findMany({
      where: { empresaId },
      orderBy: { creadoEn: 'asc' },
    });
    const ids = cuentas.map((c) => c.id);
    if (ids.length === 0) return [];

    const [pagos, depositos, compras, gastos] = await Promise.all([
      this.prisma.pago.groupBy({
        by: ['cuentaBancariaId'],
        where: { cuentaBancariaId: { in: ids } },
        _sum: { monto: true },
      }),
      this.prisma.movimientoCaja.groupBy({
        by: ['cuentaBancariaId'],
        where: {
          cuentaBancariaId: { in: ids },
          tipoMovimiento: 'CIERRE',
          depositado: true,
        },
        _sum: { montoEfectivo: true },
      }),
      this.prisma.pagoCompra.groupBy({
        by: ['cuentaBancariaId'],
        where: { cuentaBancariaId: { in: ids } },
        _sum: { monto: true },
      }),
      this.prisma.gastoOperativo.groupBy({
        by: ['cuentaBancariaId'],
        where: { cuentaBancariaId: { in: ids } },
        _sum: { monto: true },
      }),
    ]);

    const toMap = (arr: any[], field: string) =>
      new Map<number, number>(
        arr
          .filter((r) => r.cuentaBancariaId != null)
          .map((r) => [r.cuentaBancariaId as number, Number(r._sum[field] || 0)]),
      );
    const mPagos = toMap(pagos, 'monto');
    const mDep = toMap(depositos, 'montoEfectivo');
    const mCompras = toMap(compras, 'monto');
    const mGastos = toMap(gastos, 'monto');

    return cuentas.map((c) => {
      const ingresos = (mPagos.get(c.id) || 0) + (mDep.get(c.id) || 0);
      const egresos = (mCompras.get(c.id) || 0) + (mGastos.get(c.id) || 0);
      return {
        ...c,
        ingresos: Number(ingresos.toFixed(2)),
        egresos: Number(egresos.toFixed(2)),
        saldo: Number((ingresos - egresos).toFixed(2)),
      };
    });
  }

  /**
   * Movimientos de una cuenta bancaria (ledger simple), unificando las 4
   * fuentes en una lista normalizada ordenada por fecha desc.
   */
  async movimientosCuentaBancaria(
    empresaId: number,
    cuentaId: number,
    desde?: string,
    hasta?: string,
  ) {
    const cuenta = await this.prisma.cuentaBancaria.findFirst({
      where: { id: cuentaId, empresaId },
    });
    if (!cuenta) throw new NotFoundException('Cuenta bancaria no encontrada');

    const rango =
      desde || hasta
        ? {
            gte: desde ? new Date(`${desde}T00:00:00.000-05:00`) : undefined,
            lte: hasta ? new Date(`${hasta}T23:59:59.999-05:00`) : undefined,
          }
        : undefined;

    const [pagos, depositos, compras, gastos] = await Promise.all([
      this.prisma.pago.findMany({
        where: { cuentaBancariaId: cuentaId, ...(rango ? { fecha: rango } : {}) },
        select: {
          id: true,
          fecha: true,
          monto: true,
          referencia: true,
          comprobante: { select: { serie: true, correlativo: true } },
        },
      }),
      this.prisma.movimientoCaja.findMany({
        where: {
          cuentaBancariaId: cuentaId,
          tipoMovimiento: 'CIERRE',
          depositado: true,
          ...(rango ? { fechaDeposito: rango } : {}),
        },
        select: {
          id: true,
          fechaDeposito: true,
          montoEfectivo: true,
          numeroOperacionDeposito: true,
        },
      }),
      this.prisma.pagoCompra.findMany({
        where: { cuentaBancariaId: cuentaId, ...(rango ? { fecha: rango } : {}) },
        select: { id: true, fecha: true, monto: true, referencia: true },
      }),
      this.prisma.gastoOperativo.findMany({
        where: { cuentaBancariaId: cuentaId, ...(rango ? { fecha: rango } : {}) },
        select: {
          id: true,
          fecha: true,
          creadoEn: true,
          monto: true,
          descripcion: true,
          numeroOperacion: true,
        },
      }),
    ]);

    const movimientos = [
      ...pagos.map((p) => ({
        id: `pago-${p.id}`,
        fecha: p.fecha,
        tipo: 'INGRESO' as const,
        origen: 'COBRO',
        concepto: p.comprobante
          ? `Cobro ${p.comprobante.serie}-${p.comprobante.correlativo}`
          : 'Cobro',
        referencia: p.referencia || null,
        monto: Number(p.monto),
      })),
      ...depositos.map((d) => ({
        id: `dep-${d.id}`,
        fecha: d.fechaDeposito as Date,
        tipo: 'INGRESO' as const,
        origen: 'DEPOSITO',
        concepto: 'Depósito de efectivo (cierre de caja)',
        referencia: d.numeroOperacionDeposito || null,
        monto: Number(d.montoEfectivo || 0),
      })),
      ...compras.map((c) => ({
        id: `compra-${c.id}`,
        fecha: c.fecha,
        tipo: 'EGRESO' as const,
        origen: 'COMPRA',
        concepto: 'Pago a proveedor',
        referencia: c.referencia || null,
        monto: Number(c.monto),
      })),
      ...gastos.map((g) => ({
        id: `gasto-${g.id}`,
        fecha: (g.fecha || g.creadoEn) as Date,
        tipo: 'EGRESO' as const,
        origen: 'GASTO',
        concepto: g.descripcion || 'Gasto operativo',
        referencia: g.numeroOperacion || null,
        monto: Number(g.monto),
      })),
    ].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    const ingresos = movimientos
      .filter((m) => m.tipo === 'INGRESO')
      .reduce((s, m) => s + m.monto, 0);
    const egresos = movimientos
      .filter((m) => m.tipo === 'EGRESO')
      .reduce((s, m) => s + m.monto, 0);

    return {
      cuenta,
      ingresos: Number(ingresos.toFixed(2)),
      egresos: Number(egresos.toFixed(2)),
      saldo: Number((ingresos - egresos).toFixed(2)),
      movimientos,
    };
  }

  /**
   * Máximo una cuenta ACTIVA por medio digital (YAPE/PLIN) por empresa: es la
   * cuenta a la que ese medio abona automáticamente, tener dos sería ambiguo.
   */
  private async validarMedioVinculadoUnico(
    empresaId: number,
    medioPagoVinculado: string,
    excludeCuentaId?: number,
  ) {
    const existente = await this.prisma.cuentaBancaria.findFirst({
      where: {
        empresaId,
        medioPagoVinculado,
        activo: true,
        ...(excludeCuentaId ? { id: { not: excludeCuentaId } } : {}),
      },
      select: { banco: true, numeroCuenta: true, alias: true },
    });
    if (existente) {
      const nombre =
        existente.alias || `${existente.banco} · ${existente.numeroCuenta}`;
      throw new BadRequestException(
        `${medioPagoVinculado} ya está vinculado a la cuenta "${nombre}". Desvincúlala primero si quieres cambiarlo.`,
      );
    }
  }

  async crearCuentaBancaria(empresaId: number, dto: CreateCuentaBancariaDto) {
    if (dto.medioPagoVinculado) {
      await this.validarMedioVinculadoUnico(empresaId, dto.medioPagoVinculado);
    }
    return this.prisma.cuentaBancaria.create({
      data: {
        empresaId,
        banco: dto.banco,
        numeroCuenta: dto.numeroCuenta,
        cci: dto.cci ?? null,
        titular: dto.titular ?? null,
        tipoCuenta: dto.tipoCuenta ?? 'AHORROS',
        moneda: dto.moneda ?? 'PEN',
        alias: dto.alias ?? null,
        mostrarEnCotizacion: dto.mostrarEnCotizacion ?? true,
        medioPagoVinculado: dto.medioPagoVinculado ?? null,
      },
    });
  }

  async actualizarCuentaBancaria(
    empresaId: number,
    id: number,
    dto: UpdateCuentaBancariaDto,
  ) {
    const cuenta = await this.prisma.cuentaBancaria.findUnique({
      where: { id },
    });
    if (!cuenta) throw new NotFoundException('Cuenta bancaria no encontrada');
    if (cuenta.empresaId !== empresaId)
      throw new BadRequestException('La cuenta no pertenece a tu empresa');

    if (dto.medioPagoVinculado) {
      await this.validarMedioVinculadoUnico(
        empresaId,
        dto.medioPagoVinculado,
        id,
      );
    }

    return this.prisma.cuentaBancaria.update({
      where: { id },
      data: {
        ...(dto.banco !== undefined && { banco: dto.banco }),
        ...(dto.numeroCuenta !== undefined && {
          numeroCuenta: dto.numeroCuenta,
        }),
        ...(dto.cci !== undefined && { cci: dto.cci }),
        ...(dto.titular !== undefined && { titular: dto.titular }),
        ...(dto.tipoCuenta !== undefined && { tipoCuenta: dto.tipoCuenta }),
        ...(dto.moneda !== undefined && { moneda: dto.moneda }),
        ...(dto.alias !== undefined && { alias: dto.alias }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
        ...(dto.mostrarEnCotizacion !== undefined && {
          mostrarEnCotizacion: dto.mostrarEnCotizacion,
        }),
        ...(dto.medioPagoVinculado !== undefined && {
          medioPagoVinculado: dto.medioPagoVinculado,
        }),
      },
    });
  }

  async eliminarCuentaBancaria(empresaId: number, id: number) {
    const cuenta = await this.prisma.cuentaBancaria.findUnique({
      where: { id },
    });
    if (!cuenta) throw new NotFoundException('Cuenta bancaria no encontrada');
    if (cuenta.empresaId !== empresaId)
      throw new BadRequestException('La cuenta no pertenece a tu empresa');

    return this.prisma.cuentaBancaria.update({
      where: { id },
      data: { activo: false },
    });
  }
}
