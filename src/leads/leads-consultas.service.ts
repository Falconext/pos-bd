import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * E2/E3 — el registro de lo que los clientes preguntan.
 *
 * El anexo pide tres cosas que salen todas de acá: los productos más
 * consultados con disponibilidad vs. no disponibles (punto 27), los malestares
 * más consultados (27) y el historial de consultas de salud y de productos no
 * habidos de cada cliente (28).
 *
 * Se guarda en el momento, como fila, en vez de deducirlo después leyendo los
 * chats: el texto de la conversación no dice si lo que se buscó existía o no,
 * y reprocesarlo con IA costaría una llamada por consulta y daría un número
 * distinto cada vez que se corra.
 */

/** Palabras que delatan que lo que se busca es un malestar y no un producto. */
const SENALES_DE_MALESTAR = [
  'dolor',
  'duele',
  'malestar',
  'molestia',
  'inflam',
  'gastritis',
  'colitis',
  'estreñ',
  'estren',
  'diarrea',
  'insomnio',
  'ansiedad',
  'estres',
  'estrés',
  'depres',
  'colesterol',
  'trigliceridos',
  'triglicéridos',
  'diabet',
  'glucosa',
  'presion',
  'presión',
  'hipertens',
  'tiroide',
  'hormonal',
  'menopaus',
  'prostata',
  'próstata',
  'fertil',
  'anemia',
  'cansancio',
  'fatiga',
  'migrana',
  'migraña',
  'alergia',
  'asma',
  'bronqui',
  'tos',
  'gripe',
  'defensas',
  'inmun',
  'adelgaz',
  'bajar de peso',
  'sobrepeso',
  'obesidad',
  'acne',
  'acné',
  'caida del cabello',
  'caída del cabello',
  'varice',
  'artritis',
  'artrosis',
  'reuma',
  'higado',
  'hígado',
  'riñon',
  'riñón',
  'rinon',
  'circulacion',
  'circulación',
  'memoria',
  'vista',
  'hemorroide',
  'ulcera',
  'úlcera',
  'reflujo',
  'candidiasis',
  'infeccion',
  'infección',
  'parasito',
  'parásito',
  'desintox',
  'menstrual',
  'colico',
  'cólico',
];

export type TipoConsulta = 'PRODUCTO' | 'MALESTAR';

/**
 * ¿Lo que escribió el cliente es un malestar o el nombre de un producto?
 *
 * Es una heurística de palabras y no una llamada a la IA a propósito: cuesta
 * cero, da el mismo resultado siempre y el reporte tiene que poder
 * recalcularse sin gastar tokens. Lo que no reconoce queda como PRODUCTO, que
 * es el caso común.
 */
export function clasificarConsulta(texto: string): TipoConsulta {
  const t = (texto ?? '').toLowerCase();
  return SENALES_DE_MALESTAR.some((s) => t.includes(s))
    ? 'MALESTAR'
    : 'PRODUCTO';
}

export interface ConsultaARegistrar {
  texto: string;
  hubo: boolean;
  productoId?: number | null;
  disponibilidad?: string | null;
  /** Para forzar el tipo cuando ya se sabe (p. ej. el cuestionario). */
  tipo?: TipoConsulta;
}

@Injectable()
export class LeadsConsultasService {
  private readonly logger = new Logger(LeadsConsultasService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Registra lo que el cliente buscó. Best-effort: si falla, la atención
   * sigue — perder una fila de analítica es mucho menos grave que cortarle la
   * respuesta a quien está por comprar.
   */
  async registrar(
    empresaId: number,
    conversacionId: number,
    telefono: string,
    consultas: ConsultaARegistrar[],
  ): Promise<number> {
    const limpias = consultas
      .map((c) => ({ ...c, texto: (c.texto ?? '').trim().toLowerCase() }))
      .filter((c) => c.texto.length >= 3);
    if (!limpias.length) return 0;

    try {
      const prospecto = await this.prisma.leadProspecto.findFirst({
        where: { conversacionId, empresaId },
        select: { id: true },
      });

      const { count } = await this.prisma.leadConsulta.createMany({
        data: limpias.map((c) => ({
          empresaId,
          conversacionId,
          prospectoId: prospecto?.id ?? null,
          telefono,
          tipo: (c.tipo ?? clasificarConsulta(c.texto)) as never,
          texto: c.texto,
          hubo: c.hubo,
          productoId: c.productoId ?? null,
          disponibilidad: c.disponibilidad ?? null,
        })),
      });
      return count;
    } catch (e: any) {
      this.logger.warn(`No se pudo registrar la consulta: ${e?.message}`);
      return 0;
    }
  }

  /**
   * El historial de consultas de un cliente, por teléfono.
   *
   * Separa lo que pidió y no había: es lo que el anexo llama "productos
   * solicitados no habidos", y es la lista con la que el negocio decide qué
   * reponer y a quién avisarle cuando llegue.
   */
  async historialDe(empresaId: number, telefonos: string[]) {
    const filas = await this.prisma.leadConsulta.findMany({
      where: { empresaId, telefono: { in: telefonos } },
      orderBy: { creadoEn: 'desc' },
      take: 200,
      select: {
        texto: true,
        tipo: true,
        hubo: true,
        productoId: true,
        disponibilidad: true,
        creadoEn: true,
      },
    });

    return {
      malestares: filas.filter((f) => f.tipo === 'MALESTAR'),
      productos: filas.filter((f) => f.tipo === 'PRODUCTO' && f.hubo),
      noHabidos: filas.filter((f) => !f.hubo),
    };
  }
}
