import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Prisma, EstadoType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { KardexService } from '../kardex/kardex.service';
import * as XLSX from 'xlsx';

@Injectable()
export class ProductoService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => KardexService))
    private readonly kardexService: KardexService,
    private readonly s3: S3Service,
  ) {}

  private async generarCodigoProducto(empresaId: number, prefijo = 'PR') {
    const productos = await this.prisma.producto.findMany({
      where: { empresaId, codigo: { startsWith: prefijo } },
      select: { codigo: true },
    });
    let maxNum = 0;
    const re = new RegExp(`^${prefijo}(\\d+)$`);
    for (const { codigo } of productos) {
      const m = codigo.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }
    const siguiente = maxNum + 1;
    return `${prefijo}${siguiente.toString().padStart(3, '0')}`;
  }

  async crear(
    data: {
      codigo?: string;
      descripcion: string;
      unidadMedidaId: number;
      tipoAfectacionIGV: string;
      precioUnitario: number;
      igvPorcentaje?: number;
      stock: number;
      categoriaId?: number;
      marcaId?: number;
      stockMinimo?: number;
      stockMaximo?: number;
    },
    empresaId: number,
  ) {
    let {
      codigo,
      descripcion,
      unidadMedidaId,
      tipoAfectacionIGV,
      precioUnitario,
      igvPorcentaje = 18,
      stock,
      categoriaId,
      marcaId,
      stockMinimo,
      stockMaximo,
    } = data;

    if (!codigo) {
      codigo = await this.generarCodigoProducto(empresaId, 'PR');
    }

    const existe = await this.prisma.producto.findFirst({
      where: { codigo, empresaId },
    });
    if (existe)
      throw new ForbiddenException('Ya existe un producto con ese código');

    const unidad = await this.prisma.unidadMedida.findUnique({
      where: { id: unidadMedidaId },
    });
    if (!unidad) throw new ForbiddenException('Unidad de medida no válida');

    const tiposValidos = ['10', '20', '30', '40'];
    if (!tiposValidos.includes(tipoAfectacionIGV)) {
      throw new ForbiddenException('Tipo de afectación IGV no válido');
    }

    const divisor = 1 + igvPorcentaje / 100;
    const rawValor = precioUnitario / divisor;
    const valorUnitario = parseFloat(rawValor.toFixed(2));

    const nuevo = await this.prisma.producto.create({
      data: {
        codigo,
        descripcion,
        unidadMedidaId,
        tipoAfectacionIGV,
        precioUnitario: new Decimal(precioUnitario),
        valorUnitario: new Decimal(valorUnitario),
        igvPorcentaje: new Decimal(igvPorcentaje),
        stock,
        stockMinimo: stockMinimo != null ? stockMinimo : undefined,
        stockMaximo: stockMaximo != null ? stockMaximo : undefined,
        categoriaId:
          categoriaId && Number(categoriaId) > 0
            ? Number(categoriaId)
            : undefined,
        marcaId: marcaId && Number(marcaId) > 0 ? Number(marcaId) : undefined,
        empresaId,
      },
    });

    return nuevo;
  }

  async listar(params: {
    empresaId: number;
    search?: string;
    page?: number;
    limit?: number;
    sort?: 'id' | 'descripcion' | 'codigo';
    order?: 'asc' | 'desc';
    marcaId?: number;
  }) {
    const {
      empresaId,
      search,
      page = 1,
      limit = 10,
      sort = 'id',
      order = 'desc',
      marcaId,
    } = params;
    const skip = (page - 1) * limit;

    // Códigos de productos del sistema que no deben mostrarse a los usuarios
    const productosDelSistema = ['PLD', 'IPM', 'DGD'];

    const where: any = {
      empresaId,
      estado: { in: [EstadoType.ACTIVO, EstadoType.INACTIVO] },
      // Excluir productos del sistema (PENALIDAD, INTERES POR MORA, DESCUENTO GLOBAL)
      codigo: { notIn: productosDelSistema },
      marcaId: marcaId ? Number(marcaId) : undefined,
      OR: search
        ? [
            { descripcion: { contains: search, mode: 'insensitive' } },
            { codigo: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [productosRaw, total] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort]: order },
        select: {
          id: true,
          codigo: true,
          descripcion: true,
          imagenUrl: true,
          stock: true,
          stockMinimo: true,
          stockMaximo: true,
          costoPromedio: true,
          precioUnitario: true,
          valorUnitario: true,
          igvPorcentaje: true,
          tipoAfectacionIGV: true,
          estado: true,
          categoriaId: true,
          unidadMedidaId: true,
          marcaId: true,
          empresaId: true,
          creadoEn: true,
          unidadMedida: {
            select: {
              id: true,
              codigo: true,
              nombre: true,
            },
          },
          categoria: {
            select: {
              id: true,
              nombre: true,
            },
          },
          marca: {
            select: {
              id: true,
              nombre: true,
            },
          },
        },
      }),
      this.prisma.producto.count({ where }),
    ]);

    // Firmar imagenes si son de S3
    const signIfS3 = async (url?: string | null) => {
      try {
        if (!url) return url as any;
        const idx = url.indexOf('amazonaws.com/');
        if (idx === -1) return url as any;
        const key = url.substring(idx + 'amazonaws.com/'.length);
        if (!key) return url as any;
        const signed = await this.s3.getSignedGetUrl(key, 600);
        return signed || (url as any);
      } catch {
        return url as any;
      }
    };

    const productos = await Promise.all(
      productosRaw.map(async (p) => ({
        ...p,
        imagenUrl: await signIfS3((p as any).imagenUrl as any),
      }))
    );

    return { productos, total, page, limit };
  }

  async obtenerPorId(id: number, empresaId: number) {
    const producto = await this.prisma.producto.findFirst({
      where: { id, empresaId },
      include: { unidadMedida: true, categoria: true, marca: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    return producto;
  }

  async actualizar(data: {
    id: number;
    empresaId: number;
    descripcion?: string;
    categoriaId?: number | null;
    marcaId?: number | null;
    unidadMedidaId?: number;
    tipoAfectacionIGV?: string;
    valorUnitario?: number;
    igvPorcentaje?: number;
    precioUnitario?: number;
    stock?: number;
    costoUnitario?: number;
    stockMinimo?: number;
    stockMaximo?: number;
  }, usuarioId?: number) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: data.id, empresaId: data.empresaId },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    if (data.valorUnitario !== undefined && data.precioUnitario !== undefined) {
      const igv = data.igvPorcentaje ?? 18;
      const esperado = +(data.valorUnitario * (1 + igv / 100)).toFixed(2);
      const enviado = +Number(data.precioUnitario).toFixed(2);
      if (esperado !== enviado) {
        throw new ForbiddenException(
          `El precio con IGV no coincide (esperado: ${esperado})`,
        );
      }
    }

    // Si cambió el stock, registrar movimiento de kardex
    if (data.stock !== undefined && data.stock !== producto.stock) {
      const diferencia = data.stock - producto.stock;
      const esIngreso = diferencia > 0;
      const cantidad = Math.abs(diferencia);
      
      try {
        await this.kardexService.registrarMovimiento({
          productoId: data.id,
          empresaId: data.empresaId,
          tipoMovimiento: esIngreso ? 'INGRESO' : 'SALIDA',
          concepto: `Ajuste manual de stock desde inventario (${esIngreso ? '+' : '-'}${cantidad})`,
          cantidad,
          costoUnitario: Number(producto.costoPromedio) || 0,
          usuarioId,
          observacion: `Stock anterior: ${producto.stock}, Stock nuevo: ${data.stock}`,
        });
      } catch (error) {
        console.error('Error al registrar movimiento de kardex desde edición de producto:', error);
        // No fallar la actualización del producto por error en kardex
      }
    }

    return this.prisma.producto.update({
      where: { id: data.id },
      data: {
        descripcion: data.descripcion,
        categoriaId: data.categoriaId,
        marcaId: data.marcaId != null ? data.marcaId : undefined,
        unidadMedidaId: data.unidadMedidaId,
        tipoAfectacionIGV: data.tipoAfectacionIGV,
        valorUnitario:
          data.valorUnitario !== undefined
            ? new Decimal(data.valorUnitario)
            : undefined,
        igvPorcentaje:
          data.igvPorcentaje !== undefined
            ? new Decimal(data.igvPorcentaje)
            : undefined,
        precioUnitario:
          data.precioUnitario !== undefined
            ? new Decimal(data.precioUnitario)
            : undefined,
        costoPromedio:
          data.costoUnitario !== undefined
            ? new Decimal(data.costoUnitario)
            : undefined,
        stock: data.stock,
        stockMinimo:
          data.stockMinimo !== undefined ? data.stockMinimo : undefined,
        stockMaximo:
          data.stockMaximo !== undefined ? data.stockMaximo : undefined,
      },
    });
  }

  // ==================== IMÁGENES (S3) ====================

  async subirImagenPrincipal(
    empresaId: number,
    productoId: number,
    file: { buffer: Buffer; mimetype?: string },
  ) {
    const producto = await this.prisma.producto.findFirst({ where: { id: productoId, empresaId } });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    if (!file || !file.buffer) throw new ForbiddenException('Archivo no proporcionado');
    const ct = file.mimetype || 'image/jpeg';
    if (!/^image\//i.test(ct)) throw new ForbiddenException('El archivo debe ser una imagen');

    const s3Key = this.s3.generateProductoImageKey(empresaId, productoId, ct, false);
    const url = await this.s3.uploadImage(file.buffer, s3Key, ct);

    await this.prisma.producto.update({ where: { id: productoId }, data: { imagenUrl: url } });
    // Devolver también URL firmada para previsualización inmediata en admin
    const idx = url.indexOf('amazonaws.com/');
    const objKey = idx !== -1 ? url.substring(idx + 'amazonaws.com/'.length) : '';
    const signedUrl = objKey ? await this.s3.getSignedGetUrl(objKey, 600) : url;
    return { url, signedUrl };
  }

  async subirImagenExtra(
    empresaId: number,
    productoId: number,
    file: { buffer: Buffer; mimetype?: string },
  ) {
    const producto = await this.prisma.producto.findFirst({ where: { id: productoId, empresaId } });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    if (!file || !file.buffer) throw new ForbiddenException('Archivo no proporcionado');
    const ct = file.mimetype || 'image/jpeg';
    if (!/^image\//i.test(ct)) throw new ForbiddenException('El archivo debe ser una imagen');

    const key = this.s3.generateProductoImageKey(empresaId, productoId, ct, true);
    const url = await this.s3.uploadImage(file.buffer, key, ct);

    const actuales: string[] = Array.isArray((producto as any).imagenesExtra) ? (producto as any).imagenesExtra : [];
    const nuevas = [...actuales, url];
    await this.prisma.producto.update({ where: { id: productoId }, data: { imagenesExtra: nuevas as any } });
    const idx = url.indexOf('amazonaws.com/');
    const objKey = idx !== -1 ? url.substring(idx + 'amazonaws.com/'.length) : '';
    const signedUrl = objKey ? await this.s3.getSignedGetUrl(objKey, 600) : url;
    return { url, signedUrl };
  }

  async cambiarEstado(id: number, empresaId: number, estado: EstadoType) {
    const producto = await this.prisma.producto.findFirst({
      where: { id, empresaId },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    return this.prisma.producto.update({ where: { id }, data: { estado } });
  }

  async eliminar(id: number, empresaId: number) {
    const producto = await this.prisma.producto.findFirst({ where: { id, empresaId } });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    return this.prisma.producto.update({
      where: { id },
      data: {
        estado: 'PLACEHOLDER' as any,
        publicarEnTienda: false as any,
      },
    });
  }

  async obtenerSiguienteCodigo(empresaId: number, prefijo = 'PR') {
    return this.generarCodigoProducto(empresaId, prefijo);
  }

  async exportar(empresaId: number, search?: string): Promise<Buffer> {
    const where: any = {
      empresaId,
      estado: { in: [EstadoType.ACTIVO, EstadoType.INACTIVO] },
      OR: search
        ? [
            { descripcion: { contains: search, mode: 'insensitive' } },
            { codigo: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const productos = await this.prisma.producto.findMany({
      where,
      orderBy: { id: 'desc' },
      include: { unidadMedida: true, categoria: true, marca: true },
    });

    const datosExcel = productos.map((producto) => ({
      CÓDIGO: producto.codigo,
      PRODUCTO: producto.descripcion,
      'U.M': producto.unidadMedida?.nombre || '',
      AFECT: producto.tipoAfectacionIGV,
      'PRECIO UNITARIO': Number(producto.precioUnitario),
      IGV: Number(producto.igvPorcentaje),
      STOCK: producto.stock,
      CATEGORIA: producto.categoria?.nombre || '',
      MARCA: (producto as any)?.marca?.nombre || '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');
    worksheet['!cols'] = [
      { wch: 15 },
      { wch: 100 },
      { wch: 20 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 20 },
    ];

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    return buffer;
  }

  async cargaMasiva(fileBuffer: Buffer, empresaId: number) {
    const unidades = await this.prisma.unidadMedida.findMany({
      select: { id: true, nombre: true },
    });
    const unidadMap = new Map(
      unidades.map((u) => [
        u.nombre
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, ''),
        u.id,
      ]),
    );

    const categorias = await this.prisma.categoria.findMany({
      select: { id: true, nombre: true },
    });
    const categoriaMap = new Map(
      categorias.map((c) => [
        c.nombre
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, ''),
        c.id,
      ]),
    );

    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
    if (rows.length === 0)
      throw new ForbiddenException('El archivo Excel está vacío');

    const resultados: { producto?: any; error?: string }[] = [];
    const tiposValidos = ['10', '20', '30', '40'];

    for (const [index, row] of rows.entries()) {
      try {
        const codigo = row['CÓDIGO'] ?? row['Código'] ?? row['codigo'] ?? null;
        const descripcion =
          row['PRODUCTO'] ?? row['Producto'] ?? row['producto'] ?? null;
        const unidadNombre =
          row['U.M'] ??
          row['U.M.'] ??
          row['Unidad de Medida'] ??
          row['unidadMedida'] ??
          null;
        const afectRaw = row['AFECT'] ?? row['Afect'] ?? row['afect'] ?? null;
        const precioUnitarioRaw =
          row['PRECIO UNITARIO'] ??
          row['Precio Unitario'] ??
          row['precioUnitario'] ??
          null;
        const igvRaw = row['IGV'] ?? row['igv'] ?? null;
        const stockRaw = row['STOCK'] ?? row['Stock'] ?? row['stock'] ?? null;
        const categoriaRaw =
          row['CATEGORIA'] ?? row['Categoría'] ?? row['categoria'] ?? null;

        if (!codigo)
          throw new ForbiddenException(
            `Código no proporcionado en la fila ${index + 1}`,
          );
        if (!descripcion)
          throw new ForbiddenException(
            `Descripción no proporcionada en la fila ${index + 1}`,
          );
        if (!unidadNombre)
          throw new ForbiddenException(
            `Unidad de medida no proporcionada en la fila ${index + 1}`,
          );

        const unidadKey = unidadNombre
          .toString()
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        const unidadMedidaId = unidadMap.get(unidadKey);
        if (!unidadMedidaId)
          throw new ForbiddenException(
            `Unidad de medida no válida (${unidadNombre}) en la fila ${index + 1}`,
          );

        let tipoAfectacionIGV = afectRaw ? afectRaw.toString().trim() : '10';
        if (!tiposValidos.includes(tipoAfectacionIGV)) {
          const n = parseInt(tipoAfectacionIGV, 10);
          tipoAfectacionIGV = tiposValidos.includes(n.toString())
            ? n.toString()
            : '10';
        }

        const precioUnitario = parseFloat(precioUnitarioRaw?.toString());
        const stock = parseInt(stockRaw?.toString(), 10);
        const igvPorcentaje = igvRaw ? parseFloat(igvRaw.toString()) : 18;

        const categoriaKey = categoriaRaw
          ? categoriaRaw
              .toString()
              .toUpperCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
          : null;
        const categoriaId = categoriaKey
          ? categoriaMap.get(categoriaKey)
          : undefined;
        if (categoriaKey && !categoriaId)
          throw new ForbiddenException(
            `Categoría no válida (${categoriaRaw}) en la fila ${index + 1}`,
          );

        const producto = await this.crear(
          {
            codigo: codigo.toString(),
            descripcion: descripcion.toString(),
            unidadMedidaId: Number(unidadMedidaId),
            tipoAfectacionIGV,
            precioUnitario,
            igvPorcentaje,
            stock,
            categoriaId: categoriaId ? Number(categoriaId) : undefined,
          },
          empresaId,
        );
        resultados.push({ producto });
      } catch (e: any) {
        resultados.push({ error: e?.message || 'Error desconocido' });
      }
    }

    return {
      total: rows.length,
      exitosos: resultados.filter((r) => r.producto).length,
      fallidos: resultados.filter((r) => r.error).length,
      detalles: resultados,
    };
  }
}
