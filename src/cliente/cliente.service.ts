import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PersonaType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import * as XLSX from 'xlsx';

@Injectable()
export class ClienteService {
  constructor(private readonly prisma: PrismaService) { }

  async crear(data: {
    nombre: string;
    tipoDoc: 'DNI' | 'RUC';
    nroDoc: string;
    direccion?: string;
    email?: string;
    telefono?: string;
    empresaId: number;
    ubigeo: string;
    departamento: string;
    provincia: string;
    distrito: string;
    persona?: string;
  }) {
    const { tipoDoc, nroDoc } = data;

    if (tipoDoc === 'DNI' && nroDoc.length !== 8)
      throw new ForbiddenException('El DNI debe tener 8 dígitos');
    if (tipoDoc === 'RUC' && nroDoc.length !== 11)
      throw new ForbiddenException('El RUC debe tener 11 dígitos');

    const tipoDocumento = await this.prisma.tipoDocumento.findUnique({
      where: { codigo: tipoDoc === 'DNI' ? '1' : tipoDoc === 'RUC' ? '6' : '' },
    });
    if (!tipoDocumento)
      throw new ForbiddenException('Tipo de documento no válido');

    const existe = await this.prisma.cliente.findFirst({
      where: { nroDoc: data.nroDoc, empresaId: data.empresaId },
    });
    if (existe)
      throw new ForbiddenException('Ya existe un cliente con ese documento');

    return this.prisma.cliente.create({
      data: {
        nombre: data.nombre,
        nroDoc: data.nroDoc,
        direccion: data.direccion,
        email: data.email,
        telefono: data.telefono,
        empresaId: data.empresaId,
        tipoDocumentoId: tipoDocumento.id,
        persona: (data.persona as PersonaType) || PersonaType.CLIENTE,
        departamento: data.departamento,
        provincia: data.provincia,
        distrito: data.distrito,
        ubigeo: data.ubigeo,
      },
    });
  }

  async listar(params: {
    empresaId: number;
    search?: string;
    page?: number;
    limit?: number;
    sort?: 'id' | 'nombre' | 'nroDoc';
    order?: 'asc' | 'desc';
  }) {
    const {
      empresaId,
      search,
      page = 1,
      limit = 10,
      sort = 'id',
      order = 'desc',
    } = params;
    const skip = (page - 1) * limit;

    const where: any = {
      empresaId,
      estado: 'ACTIVO',
      ...(search
        ? {
          OR: [
            { nombre: { contains: search } },
            { nroDoc: { contains: search } },
          ],
        }
        : {}),
    };

    const [clientes, total] = await Promise.all([
      this.prisma.cliente.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort]: order },
        include: { tipoDocumento: true },
      }),
      this.prisma.cliente.count({ where }),
    ]);

    return { clientes, total, page, limit };
  }

  async obtenerPorId(id: number, empresaId: number) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id, empresaId },
      include: { tipoDocumento: true },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    return cliente;
  }

  async actualizar(data: {
    id: number;
    empresaId: number;
    nombre?: string;
    direccion?: string;
    email?: string;
    telefono?: string;
    ubigeo?: string;
    departamento?: string;
    provincia?: string;
    distrito?: string;
    persona?: string;
  }) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: data.id, empresaId: data.empresaId },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    return this.prisma.cliente.update({
      where: { id: data.id },
      data: {
        nombre: data.nombre,
        direccion: data.direccion,
        email: data.email,
        telefono: data.telefono,
        ubigeo: data.ubigeo,
        departamento: data.departamento,
        provincia: data.provincia,
        distrito: data.distrito,
        persona: data.persona as PersonaType,
      },
    });
  }

  async cambiarEstado(
    id: number,
    empresaId: number,
    estado: 'ACTIVO' | 'INACTIVO',
  ) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id, empresaId },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    return this.prisma.cliente.update({ where: { id }, data: { estado } });
  }

  async consultarDocumento(numero: string, tipo: 'DNI' | 'RUC') {
    if (tipo === 'DNI' && numero.length !== 8)
      throw new ForbiddenException('El DNI debe tener 8 dígitos');
    if (tipo === 'RUC' && numero.length !== 11)
      throw new ForbiddenException('El RUC debe tener 11 dígitos');

    const url =
      tipo === 'DNI'
        ? 'https://apiperu.dev/api/dni'
        : 'https://apiperu.dev/api/ruc';
    const body = tipo === 'DNI' ? { dni: numero } : { ruc: numero };
    const token = process.env.RENIEC_TOKEN;

    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data?.data;
  }

  async exportar(empresaId: number, search?: string): Promise<Buffer> {
    const where: any = {
      empresaId,
      estado: { in: ['ACTIVO', 'INACTIVO'] },
      OR: search
        ? [
          { nombre: { contains: search } },
          { nroDoc: { contains: search } },
        ]
        : undefined,
    };

    const clientes = await this.prisma.cliente.findMany({
      where,
      orderBy: { id: 'desc' },
    });

    const datosExcel = clientes.map((c) => ({
      'NOMBRE O RAZON SOCIAL': c.nombre,
      'NUM. DOC': c.nroDoc,
      DIRECCION: c.direccion || '',
      CORREO: c.email || '',
      PERSONA: c.persona?.toString().replace('_', '-') || 'CLIENTE',
      CELULAR: c.telefono || '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Clientes');
    // Ajuste de anchos de columna aproximados
    (worksheet as any)['!cols'] = [
      { wch: 40 }, // NOMBRE O RAZON SOCIAL
      { wch: 15 }, // NUM. DOC
      { wch: 35 }, // DIRECCION
      { wch: 28 }, // CORREO
      { wch: 18 }, // PERSONA
      { wch: 15 }, // CELULAR
    ];

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    return buffer;
  }

  async cargaMasiva(fileBuffer: Buffer, empresaId: number) {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
    if (rows.length === 0)
      throw new ForbiddenException('El archivo Excel está vacío');

    const resultados: { cliente?: any; error?: string }[] = [];

    const normalizarPersona = (valor: any): string => {
      const v = (valor || '').toString().trim().toUpperCase();
      if (v === 'CLIENTE') return 'CLIENTE';
      if (v === 'PROVEEDOR') return 'PROVEEDOR';
      if (v === 'CLIENTE-PROVEEDOR' || v === 'CLIENTE_PROVEEDOR')
        return 'CLIENTE_PROVEEDOR';
      return 'CLIENTE';
    };

    for (const [index, row] of rows.entries()) {
      try {
        const nombre =
          row['NOMBRE O RAZON SOCIAL'] || row['Nombre o Razon social'] || row['NOMBRE'] || row['Nombre'] || null;
        const nroDoc = row['NUM. DOC'] || row['Num. doc'] || row['Documento'] || row['NroDoc'] || row['nroDoc'] || null;
        const direccion = row['DIRECCION'] || row['Direccion'] || row['direccion'] || '';
        const email = row['CORREO'] || row['Correo'] || row['correo'] || '';
        const persona = normalizarPersona(row['PERSONA'] || row['Persona'] || row['persona']);
        const telefono = row['CELULAR'] || row['Celular'] || row['celular'] || '';

        if (!nombre)
          throw new ForbiddenException(
            `Nombre/Razón social no proporcionado en la fila ${index + 1}`,
          );
        if (!nroDoc)
          throw new ForbiddenException(
            `Número de documento no proporcionado en la fila ${index + 1}`,
          );

        const docStr = nroDoc.toString();
        const tipoDoc: 'DNI' | 'RUC' = docStr.length === 8 ? 'DNI' : docStr.length === 11 ? 'RUC' : (() => { throw new ForbiddenException(`Número de documento inválido en la fila ${index + 1}`); })();

        const cliente = await this.crear(
          {
            nombre: nombre.toString(),
            tipoDoc,
            nroDoc: docStr,
            direccion: direccion?.toString() || undefined,
            email: email?.toString() || undefined,
            telefono: telefono?.toString() || undefined,
            empresaId,
            ubigeo: '',
            departamento: '',
            provincia: '',
            distrito: '',
            persona,
          },
        );
        resultados.push({ cliente });
      } catch (e: any) {
        resultados.push({ error: e?.message || 'Error desconocido' });
      }
    }

    return {
      total: rows.length,
      exitosos: resultados.filter((r) => r.cliente).length,
      fallidos: resultados.filter((r) => r.error).length,
      detalles: resultados,
    };
  }
}
