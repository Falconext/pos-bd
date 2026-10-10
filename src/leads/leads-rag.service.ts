import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from '../gemini/gemini.service';

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

/**
 * RAG del módulo de leads (portado de salesfilter-ai, sobre Gemini + pgvector).
 * Parte los documentos de entrenamiento en fragmentos, guarda su embedding
 * (768 dims) y recupera los más similares a un mensaje para dar contexto a la IA.
 *
 * El embedding se lee/escribe con SQL crudo porque Prisma no soporta el tipo
 * `vector` de pgvector directamente (columna declarada como Unsupported).
 */
/**
 * Hasta dónde puede estar un fragmento para considerarlo pertinente (distancia
 * coseno de pgvector: 0 es idéntico).
 *
 * Sin corte, la búsqueda vectorial SIEMPRE devuelve los vecinos más cercanos
 * por lejos que estén: "xyzqwerty" traía tres productos reales. Medido contra
 * las fichas de Hierba Sana, las dolencias de verdad caen entre 0.33 y 0.40 y
 * lo que no viene a cuento, por encima de 0.44.
 *
 * Conviene volver a medirlo cuando esté cargado el catálogo completo de
 * fichas: con más vecinos, las distancias bajan.
 */
export const DISTANCIA_MAXIMA = 0.42;

@Injectable()
export class RagVentasService {
  private readonly logger = new Logger(RagVentasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiService,
  ) {}

  /** Parte el texto en fragmentos de ~1000 chars con solape de 200. */
  chunkText(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + CHUNK_SIZE, text.length);
      chunks.push(text.slice(start, end).trim());
      start += CHUNK_SIZE - CHUNK_OVERLAP;
    }
    return chunks.filter((c) => c.length > 50);
  }

  /** Serializa un vector a la forma que entiende pgvector: `[a,b,c]`. */
  private vectorLiteral(v: number[]): string {
    return `[${v.join(',')}]`;
  }

  /**
   * Indexa un documento: borra sus fragmentos previos, parte el contenido,
   * genera embeddings y los inserta. Marca el documento INDEXADO o ERROR.
   */
  async indexarDocumento(
    documentoId: number,
    contenido: string,
  ): Promise<void> {
    try {
      await this.prisma.leadFragmento.deleteMany({ where: { documentoId } });
      const chunks = this.chunkText(contenido);
      if (chunks.length === 0) {
        await this.marcar(documentoId, 'INDEXADO', null);
        return;
      }
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await this.gemini.generarEmbedding(chunks[i]);
        const lit = this.vectorLiteral(embedding);
        await this.prisma.$executeRaw`
          INSERT INTO "LeadFragmento" ("documentoId", "indice", "contenido", "embedding", "creadoEn")
          VALUES (${documentoId}, ${i}, ${chunks[i]}, ${lit}::vector, now())
        `;
      }
      await this.marcar(documentoId, 'INDEXADO', null);
      this.logger.log(
        `Documento ${documentoId} indexado (${chunks.length} fragmentos).`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error desconocido';
      this.logger.error(`Error indexando documento ${documentoId}: ${msg}`);
      await this.marcar(documentoId, 'ERROR', msg).catch(() => undefined);
    }
  }

  private async marcar(
    documentoId: number,
    estado: 'PENDIENTE' | 'INDEXADO' | 'ERROR',
    error: string | null,
  ): Promise<void> {
    await this.prisma.leadDocumento.update({
      where: { id: documentoId },
      data: { estado, error: error ?? null },
    });
  }

  /**
   * Recupera los `limit` fragmentos más similares al texto de consulta dentro de
   * la empresa (coseno). Devuelve el contexto concatenado, listo para el prompt.
   * Si no hay documentos o algo falla, devuelve '' (la IA sigue sin RAG).
   */
  async buscarContexto(
    empresaId: number,
    consulta: string,
    limit = 5,
  ): Promise<string> {
    const fragmentos = await this.buscarFragmentos(empresaId, consulta, limit);
    return fragmentos.join('\n\n---\n\n');
  }

  /**
   * Los fragmentos más parecidos a la consulta, por orden de cercanía.
   *
   * Separado de `buscarContexto` porque B4 no quiere el texto pegado para el
   * prompt: quiere los fragmentos para sacarles los códigos de producto y
   * resolverlos contra el catálogo vivo.
   */
  async buscarFragmentos(
    empresaId: number,
    consulta: string,
    limit = 5,
    distanciaMaxima = DISTANCIA_MAXIMA,
  ): Promise<string[]> {
    try {
      const embedding = await this.gemini.generarEmbedding(consulta);
      const lit = this.vectorLiteral(embedding);
      const rows = await this.prisma.$queryRaw<{ contenido: string }[]>`
        SELECT f."contenido"
        FROM "LeadFragmento" f
        JOIN "LeadDocumento" d ON f."documentoId" = d."id"
        WHERE d."empresaId" = ${empresaId} AND d."estado"::text = 'INDEXADO'
          AND (f."embedding" <=> ${lit}::vector) < ${distanciaMaxima}
        ORDER BY f."embedding" <=> ${lit}::vector
        LIMIT ${limit}
      `;
      return rows.map((r) => r.contenido);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      this.logger.warn(`RAG buscarFragmentos empresa ${empresaId}: ${msg}`);
      return [];
    }
  }
}

/**
 * Saca los códigos de producto que menciona una ficha del RAG.
 *
 * Las fichas se generan con la forma `NOMBRE — S/ PRECIO (cód. PROD-0428)`.
 * El código es lo único que vale la pena extraer: el precio del texto queda
 * viejo en cuanto cambia el catálogo, así que se resuelve contra la base y se
 * lee el precio vivo. Por eso la ficha sirve para ENCONTRAR el producto, no
 * para cotizarlo.
 *
 * Conserva el orden de aparición, que es el orden de relevancia del RAG, y no
 * repite códigos.
 */
export function codigosDeFichas(fragmentos: string[]): string[] {
  const vistos = new Set<string>();
  for (const fragmento of fragmentos) {
    for (const m of fragmento.matchAll(/\(c[oó]d\.\s*([A-Za-z0-9._-]+)\)/gi)) {
      vistos.add(m[1].trim());
    }
  }
  return [...vistos];
}
