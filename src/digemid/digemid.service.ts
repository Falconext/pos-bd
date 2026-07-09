import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DigemidService {
  constructor(private readonly prisma: PrismaService) {}

  async buscar(q: string, limit = 20) {
    if (!q || q.trim().length < 2) return [];

    const term = q.trim();

    return this.prisma.digemidProducto.findMany({
      where: {
        estado: 'VIGENTE',
        OR: [
          { nombreComercial: { contains: term, mode: 'insensitive' } },
          { principioActivo: { contains: term, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ nombreComercial: 'asc' }],
      take: limit,
      select: {
        id: true,
        nombreComercial: true,
        principioActivo: true,
        formaFarmaceutica: true,
        concentracion: true,
        presentacion: true,
        laboratorio: true,
        registroSanitario: true,
        condicionVenta: true,
        codigoBarras: true,
      },
    });
  }

  async buscarPorBarcode(codigoBarras: string) {
    if (!codigoBarras) return null;

    return this.prisma.digemidProducto.findFirst({
      where: {
        codigoBarras,
        estado: 'VIGENTE',
      },
      select: {
        id: true,
        nombreComercial: true,
        principioActivo: true,
        formaFarmaceutica: true,
        concentracion: true,
        presentacion: true,
        laboratorio: true,
        registroSanitario: true,
        condicionVenta: true,
        codigoBarras: true,
      },
    });
  }

  async totalRegistros() {
    return this.prisma.digemidProducto.count();
  }
}
