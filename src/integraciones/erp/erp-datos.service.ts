import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClienteService } from '../../cliente/cliente.service';
import { ErpApiService } from './erp.service';
import { DOC_PUBLICO, leerCambioCliente, leerClienteNuevo, leerNombre } from './entrada-datos';
import { invalido } from './entrada-producto';

/** Lo que se lee de un cliente para la API. */
const SELECT_CLIENTE = {
  id: true,
  nombre: true,
  nroDoc: true,
  email: true,
  telefono: true,
  direccion: true,
  tipoDocumento: { select: { codigo: true } },
} as const;

const serializarCliente = (c: any, livemode?: boolean) => ({
  object: 'customer',
  ...(livemode === false ? { livemode: false } : {}),
  id: c.id ?? null,
  document_type: DOC_PUBLICO[c.tipoDocumento?.codigo ?? ''] ?? null,
  document_number: c.nroDoc ?? null,
  name: c.nombre,
  email: c.email || null,
  phone: c.telefono || null,
  address: c.direccion || null,
});

/** Los proveedores viven en la misma tabla, pero no son clientes de la web. */
const SOLO_CLIENTES = { persona: { in: ['CLIENTE', 'CLIENTE_PROVEEDOR', 'EMPRESA'] as never[] } };

/**
 * Categorías, marcas y clientes por la API de Krezka (`/v1/erp`).
 *
 * El alta de clientes pasa por `ClienteService.crear`, el mismo del panel:
 * valida el documento igual y nunca duplica por documento. Con una clave
 * `sk_test_` todo se valida y nada se crea (`livemode: false`).
 */
@Injectable()
export class ErpDatosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: ErpApiService,
    private readonly clientes: ClienteService,
  ) {}

  async crearCategoria(empresaId: number, body: unknown, prueba = false) {
    await this.erp.asegurarPlan(empresaId);
    const nombre = leerNombre(body, 'categoría');
    const existe = await this.prisma.categoria.findFirst({
      where: { empresaId, nombre: { equals: nombre, mode: 'insensitive' } },
      select: { id: true, nombre: true },
    });
    if (existe) {
      throw new ConflictException({
        code: 'duplicate_name',
        message: `Ya existe la categoría "${existe.nombre}" (id ${existe.id}). Usa ese id en category_id.`,
        param: 'name',
        id: existe.id,
      });
    }
    if (prueba) return { object: 'category', livemode: false, id: null, name: nombre };
    const c = await this.prisma.categoria.create({ data: { nombre, empresaId }, select: { id: true, nombre: true } });
    return { object: 'category', id: c.id, name: c.nombre };
  }

  async crearMarca(empresaId: number, body: unknown, prueba = false) {
    await this.erp.asegurarPlan(empresaId);
    const nombre = leerNombre(body, 'marca');
    const existe = await this.prisma.marca.findFirst({
      where: { empresaId, nombre: { equals: nombre, mode: 'insensitive' } },
      select: { id: true, nombre: true },
    });
    if (existe) {
      throw new ConflictException({
        code: 'duplicate_name',
        message: `Ya existe la marca "${existe.nombre}" (id ${existe.id}). Usa ese id en brand_id.`,
        param: 'name',
        id: existe.id,
      });
    }
    if (prueba) return { object: 'brand', livemode: false, id: null, name: nombre };
    const m = await this.prisma.marca.create({ data: { nombre, empresaId }, select: { id: true, nombre: true } });
    return { object: 'brand', id: m.id, name: m.nombre };
  }

  /** Por nombre, documento, correo o celular; se pagina por id. */
  async listarClientes(empresaId: number, query: { search?: string; document_number?: string; limit?: string; cursor?: string }) {
    await this.erp.asegurarPlan(empresaId);
    const limite = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const cursor = Number(query.cursor) || 0;
    const busca = String(query.search ?? '').trim();
    const filas = await this.prisma.cliente.findMany({
      where: {
        empresaId,
        estado: 'ACTIVO' as never,
        ...SOLO_CLIENTES,
        ...(query.document_number ? { nroDoc: String(query.document_number).trim() } : {}),
        ...(busca
          ? {
              OR: [
                { nombre: { contains: busca, mode: 'insensitive' } },
                { nroDoc: { contains: busca } },
                { email: { contains: busca, mode: 'insensitive' } },
                { telefono: { contains: busca } },
              ],
            }
          : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: SELECT_CLIENTE,
      orderBy: { id: 'asc' },
      take: limite + 1,
    });
    const pagina = filas.slice(0, limite);
    return {
      object: 'list',
      data: pagina.map((c) => serializarCliente(c)),
      has_more: filas.length > limite,
      next_cursor: filas.length > limite ? String(pagina[pagina.length - 1].id) : null,
    };
  }

  async obtenerCliente(empresaId: number, id: unknown) {
    await this.erp.asegurarPlan(empresaId);
    return serializarCliente(await this.clientePropio(empresaId, id));
  }

  async crearCliente(empresaId: number, body: unknown, prueba = false) {
    await this.erp.asegurarPlan(empresaId);
    const c = leerClienteNuevo(body);
    const existe = await this.prisma.cliente.findFirst({
      where: { empresaId, nroDoc: c.numero },
      select: { id: true, persona: true, nombre: true },
    });
    // Un proveedor con ese documento pasa a ser también cliente (como en el
    // panel); un cliente ya existente no se duplica.
    if (existe && existe.persona !== 'PROVEEDOR') {
      throw new ConflictException({
        code: 'duplicate_customer',
        message: `Ya existe el cliente ${existe.nombre} con el documento ${c.numero} (id ${existe.id}).`,
        param: 'document_number',
        id: existe.id,
      });
    }
    if (prueba) {
      return serializarCliente(
        {
          id: null,
          nombre: c.nombre,
          nroDoc: c.numero,
          email: c.email,
          telefono: c.telefono,
          direccion: c.direccion,
          tipoDocumento: { codigo: { DNI: '1', RUC: '6', CE: '4', PASAPORTE: '7' }[c.tipo!] },
        },
        false,
      );
    }
    let creado: any;
    try {
      creado = await this.clientes.crear({
        empresaId,
        tipoDoc: c.tipo!,
        nroDoc: c.numero,
        nombre: c.nombre,
        email: c.email,
        telefono: c.telefono,
        direccion: c.direccion,
        ubigeo: '',
        departamento: '',
        provincia: '',
        distrito: '',
      });
    } catch (e: any) {
      // El panel valida el documento a su manera (p. ej. dígito verificador):
      // su mensaje se devuelve tal cual, en el formato de la API.
      throw invalido('document_number', e?.response?.message ?? e?.message ?? 'No se pudo crear el cliente.');
    }
    return this.obtenerCliente(empresaId, creado.id);
  }

  async actualizarCliente(empresaId: number, id: unknown, body: unknown, prueba = false) {
    await this.erp.asegurarPlan(empresaId);
    const actual = await this.clientePropio(empresaId, id);
    const c = leerCambioCliente(body);
    const data = {
      ...(c.nombre !== undefined ? { nombre: c.nombre } : {}),
      ...(c.email !== undefined ? { email: c.email || null } : {}),
      ...(c.telefono !== undefined ? { telefono: c.telefono || null } : {}),
      ...(c.direccion !== undefined ? { direccion: c.direccion || null } : {}),
    };
    if (prueba) return serializarCliente({ ...actual, ...data }, false);
    await this.prisma.cliente.update({ where: { id: actual.id }, data });
    return this.obtenerCliente(empresaId, actual.id);
  }

  private async clientePropio(empresaId: number, id: unknown) {
    const n = Number(id);
    const c = Number.isInteger(n) && n > 0
      ? await this.prisma.cliente.findFirst({ where: { id: n, empresaId, ...SOLO_CLIENTES }, select: SELECT_CLIENTE })
      : null;
    if (!c) {
      throw new NotFoundException({ code: 'resource_missing', message: `No existe el cliente ${String(id)} en este negocio.`, param: 'id' });
    }
    return c;
  }
}
