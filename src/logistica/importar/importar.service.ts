import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma/prisma.service';

const COMBUSTIBLES = ['GASOLINA', 'DIESEL', 'GLP', 'GNV', 'ELECTRICO', 'HIBRIDO'];

export interface ResultadoImport {
  total: number;
  creados: number;
  omitidos: number;
  errores: { fila: number; motivo: string }[];
}

@Injectable()
export class ImportarService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lee la primera hoja del archivo base64 como arreglo de objetos. */
  private leerFilas(archivoBase64: string): Record<string, any>[] {
    try {
      const base64 = archivoBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
        defval: null,
        raw: false,
      });
      // Normaliza claves a minúsculas sin espacios ni acentos
      return filas.map((f) => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(f)) {
          const key = k
            .toString()
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, '');
          out[key] = typeof v === 'string' ? v.trim() : v;
        }
        return out;
      });
    } catch {
      throw new BadRequestException('No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) o CSV válido.');
    }
  }

  private pick(fila: Record<string, any>, claves: string[]): any {
    for (const c of claves) {
      if (fila[c] != null && fila[c] !== '') return fila[c];
    }
    return null;
  }

  async importarVehiculos(
    empresaId: number,
    archivoBase64: string,
  ): Promise<ResultadoImport> {
    const filas = this.leerFilas(archivoBase64);
    const res: ResultadoImport = { total: filas.length, creados: 0, omitidos: 0, errores: [] };

    // Cache de tipos de vehículo por nombre normalizado
    const tipos = await this.prisma.tipoVehiculoLogistica.findMany({ where: { empresaId } });
    const tipoPorNombre = new Map(tipos.map((t) => [t.nombre.toLowerCase(), t]));

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const nFila = i + 2; // +2: fila de encabezado + base 1
      try {
        const placa = this.pick(fila, ['placa']);
        const marca = this.pick(fila, ['marca']);
        if (!placa || !marca) {
          res.errores.push({ fila: nFila, motivo: 'Faltan Placa o Marca' });
          continue;
        }

        const existe = await this.prisma.vehiculoLogistica.findUnique({
          where: { empresaId_placa: { empresaId, placa: String(placa) } },
        });
        if (existe) {
          res.omitidos++;
          continue;
        }

        // Resolver tipo de vehículo (por nombre, o crear uno)
        const nombreTipo = String(this.pick(fila, ['tipo', 'tipovehiculo']) ?? 'General');
        let tipo = tipoPorNombre.get(nombreTipo.toLowerCase());
        const pesoRow = Number(this.pick(fila, ['capacidadpesokg', 'pesokg', 'capacidadpeso'])) || null;
        const volRow = Number(this.pick(fila, ['capacidadvolumenm3', 'volumenm3', 'capacidadvolumen'])) || null;
        if (!tipo) {
          tipo = await this.prisma.tipoVehiculoLogistica.create({
            data: {
              empresaId,
              nombre: nombreTipo,
              capacidadPesoKg: pesoRow ?? 1000,
              capacidadVolumenM3: volRow ?? 5,
            },
          });
          tipoPorNombre.set(nombreTipo.toLowerCase(), tipo);
        }

        const combRaw = String(this.pick(fila, ['combustible', 'tipocombustible']) ?? 'DIESEL').toUpperCase();
        const tipoCombustible = COMBUSTIBLES.includes(combRaw) ? combRaw : 'DIESEL';
        const anio = Number(this.pick(fila, ['anio', 'ano', 'year'])) || null;

        await this.prisma.vehiculoLogistica.create({
          data: {
            empresaId,
            tipoVehiculoId: tipo.id,
            placa: String(placa),
            marca: String(marca),
            modelo: this.pick(fila, ['modelo']) ? String(this.pick(fila, ['modelo'])) : null,
            anio,
            capacidadPesoKg: pesoRow ?? Number(tipo.capacidadPesoKg),
            capacidadVolumenM3: volRow ?? Number(tipo.capacidadVolumenM3),
            tipoCombustible: tipoCombustible as any,
          },
        });
        res.creados++;
      } catch (e: any) {
        res.errores.push({ fila: nFila, motivo: e.message || 'Error al crear el vehículo' });
      }
    }
    return res;
  }

  async importarConductores(
    empresaId: number,
    archivoBase64: string,
  ): Promise<ResultadoImport> {
    const filas = this.leerFilas(archivoBase64);
    const res: ResultadoImport = { total: filas.length, creados: 0, omitidos: 0, errores: [] };

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const nFila = i + 2;
      try {
        const nombre = this.pick(fila, ['nombre', 'nombres']);
        const apellido = this.pick(fila, ['apellido', 'apellidos']);
        if (!nombre || !apellido) {
          res.errores.push({ fila: nFila, motivo: 'Faltan Nombre o Apellido' });
          continue;
        }
        const dni = this.pick(fila, ['dni', 'documento']);
        if (dni) {
          const existe = await this.prisma.conductorLogistica.findFirst({
            where: { empresaId, dni: String(dni) },
          });
          if (existe) {
            res.omitidos++;
            continue;
          }
        }
        await this.prisma.conductorLogistica.create({
          data: {
            empresaId,
            nombre: String(nombre),
            apellido: String(apellido),
            dni: dni ? String(dni) : null,
            celular: this.pick(fila, ['celular', 'telefono']) ? String(this.pick(fila, ['celular', 'telefono'])) : null,
            email: this.pick(fila, ['email', 'correo']) ? String(this.pick(fila, ['email', 'correo'])) : null,
            nroLicencia: this.pick(fila, ['nrolicencia', 'licencia']) ? String(this.pick(fila, ['nrolicencia', 'licencia'])) : null,
            tipoLicencia: this.pick(fila, ['tipolicencia']) ? String(this.pick(fila, ['tipolicencia'])) : null,
          },
        });
        res.creados++;
      } catch (e: any) {
        res.errores.push({ fila: nFila, motivo: e.message || 'Error al crear el conductor' });
      }
    }
    return res;
  }

  /** Genera una plantilla .xlsx (base64) con encabezados y un ejemplo. */
  plantilla(tipo: 'vehiculos' | 'conductores'): { nombreArchivo: string; base64: string } {
    const ejemplo =
      tipo === 'vehiculos'
        ? [
            {
              Placa: 'ABC-123',
              Marca: 'Volvo',
              Modelo: 'FH 460',
              Anio: 2021,
              Tipo: 'Camión',
              Combustible: 'DIESEL',
              CapacidadPesoKg: 5000,
              CapacidadVolumenM3: 30,
            },
          ]
        : [
            {
              Nombre: 'Juan',
              Apellido: 'Pérez',
              DNI: '44556677',
              Celular: '999888777',
              Email: 'juan@correo.com',
              NroLicencia: 'Q44556677',
              TipoLicencia: 'A-IIIb',
            },
          ];
    const ws = XLSX.utils.json_to_sheet(ejemplo);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tipo === 'vehiculos' ? 'Vehiculos' : 'Conductores');
    const buffer: Buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    return {
      nombreArchivo: `plantilla_${tipo}.xlsx`,
      base64: buffer.toString('base64'),
    };
  }
}
