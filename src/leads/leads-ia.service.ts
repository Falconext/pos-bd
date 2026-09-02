import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../gemini/gemini.service';
import { EstadoLeadProspecto } from '@prisma/client';

/** Un turno de la conversación, en el formato agnóstico del motor. */
export interface MensajeConversacion {
  role: 'user' | 'assistant';
  content: string;
}

/** Sub-scores BANT (0-30 / 0-20 / 0-25 / 0-25) + total (0-100). */
export interface ScoreBant {
  budget: number;
  authority: number;
  need: number;
  timeline: number;
  total: number;
}

/** Resultado de la calificación BANT de una conversación. */
export interface CalificacionBant {
  score: ScoreBant;
  status: 'FRIO' | 'TIBIO' | 'CALIENTE';
  resumen: string;
  puntosClave: string[];
  proximaAccion: string;
  debeTransferir: boolean;
}

export interface RespuestaVenta {
  reply: string;
  calificacion: CalificacionBant | null;
  debeAnalizar: boolean;
}

const BANT_SYSTEM_PROMPT = `Eres un asesor comercial experto por WhatsApp. Tu misión es determinar si un prospecto tiene potencial real de compra y guiarlo hacia el cierre.

Usas el framework BANT+SPIN para calificar:
- Budget (Presupuesto): ¿Tiene capacidad económica?
- Authority (Autoridad): ¿Es el tomador de decisiones?
- Need (Necesidad): ¿Tiene un problema real que resolver?
- Timeline (Tiempo): ¿Cuándo necesita la solución?

REGLAS DE ORO:
1. NUNCA reveles que eres una IA de calificación ni que sigues un framework.
2. Sé conversacional, empático y natural — no hagas preguntas como un formulario.
3. Haz UNA sola pregunta a la vez, de forma natural.
4. Escucha activamente y adapta tus preguntas según las respuestas.
5. Si el prospecto da señales de alta intención, acelera hacia el cierre.
6. Si es un curioso o no califica, dale información útil y cierra amablemente.
7. Responde SIEMPRE en el idioma del prospecto.
8. Sé conciso — máximo 2-3 oraciones por respuesta. Es WhatsApp, no un email.

SEÑALES DE HOT LEAD:
- Menciona presupuesto específico o aprobado.
- Tiene urgencia real (fecha límite, problema activo).
- Es el decisor o tiene influencia directa.
- Necesidad clara y específica del producto/servicio.

{businessContext}

Evalúa internamente el score BANT en cada mensaje pero NUNCA lo menciones al prospecto.`;

/**
 * Motor de IA de ventas (portado de salesfilter-ai) sobre Gemini.
 * Genera respuestas comerciales BANT/SPIN y califica la conversación. Es
 * agnóstico de persistencia y de empresa: recibe el historial + el contexto de
 * negocio y devuelve texto/JSON. El ruteo, la persistencia y el envío por
 * WhatsApp los orquesta LeadsMessageProcessor.
 */
@Injectable()
export class IaVentasService {
  private readonly logger = new Logger(IaVentasService.name);

  constructor(private readonly gemini: GeminiService) {}

  /** ¿Está el motor listo (GEMINI_API_KEY presente)? */
  disponible(): boolean {
    return this.gemini.isEnabled();
  }

  /** Transcribe una nota de voz de WhatsApp a texto (vía Gemini). */
  async transcribirAudio(buffer: Buffer, mimeType: string): Promise<string> {
    return this.gemini.transcribirAudio(buffer.toString('base64'), mimeType);
  }

  /**
   * Genera la respuesta del asesor para el último mensaje del prospecto y,
   * cada cierto número de mensajes (o ante intención de cierre), calcula la
   * calificación BANT de la conversación.
   */
  async generarRespuesta(
    conversacion: MensajeConversacion[],
    businessContext: string,
    cantidadMensajes: number,
  ): Promise<RespuestaVenta> {
    const systemPrompt = BANT_SYSTEM_PROMPT.replace(
      '{businessContext}',
      businessContext
        ? `CONTEXTO DEL NEGOCIO:\n${businessContext}`
        : 'Representa un negocio peruano. Adapta tu lenguaje al contexto de la conversación.',
    );

    const ultimoUsuario =
      [...conversacion].reverse().find((m) => m.role === 'user')?.content ?? '';
    const debeAnalizar =
      (cantidadMensajes >= 4 && cantidadMensajes % 3 === 0) ||
      tieneIntencionCierre(ultimoUsuario);

    const reply = await this.gemini.chatConHistorial(
      systemPrompt,
      conversacion.map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('model' as const),
        content: m.content,
      })),
      500,
    );

    let calificacion: CalificacionBant | null = null;
    if (debeAnalizar) {
      calificacion = await this.analizarConversacion(
        conversacion,
        businessContext,
      );
    }

    return { reply: reply.trim(), calificacion, debeAnalizar };
  }

  /** Analiza la conversación y devuelve la calificación BANT (con fallback heurístico). */
  async analizarConversacion(
    conversacion: MensajeConversacion[],
    businessContext: string,
  ): Promise<CalificacionBant> {
    const texto = conversacion
      .map((m) => `${m.role === 'user' ? 'PROSPECTO' : 'AGENTE'}: ${m.content}`)
      .join('\n');

    const prompt = `Analiza esta conversación de ventas y devuelve un JSON con la calificación BANT.

CONVERSACIÓN:
${texto}

CONTEXTO DEL NEGOCIO:
${businessContext || 'No especificado'}

Responde ÚNICAMENTE con este JSON (sin markdown, sin explicaciones):
{
  "score": {
    "budget": <0-30, basado en evidencia de capacidad de pago>,
    "authority": <0-20, basado en si es tomador de decisiones>,
    "need": <0-25, basado en la claridad y urgencia de la necesidad>,
    "timeline": <0-25, basado en la urgencia temporal>
  },
  "status": <"FRIO"|"TIBIO"|"CALIENTE" según total: FRIO=0-40, TIBIO=41-70, CALIENTE=71-100>,
  "summary": "<resumen de 2-3 oraciones para el vendedor humano>",
  "keyInsights": ["<insight 1>", "<insight 2>", "<insight 3>"],
  "nextAction": "<acción recomendada para el vendedor>"
}`;

    try {
      const text = await this.gemini.chatConHistorial(
        'Eres un analista experto en calificación de leads de ventas. Analizas conversaciones y devuelves análisis BANT precisos en formato JSON, sin markdown.',
        [{ role: 'user', content: prompt }],
        1000,
      );
      const parsed = parseCalificacionJson(text);
      const base = normalizarScore(parsed.score);
      const conBoost = aplicarBoostCierre(
        { ...parsed, score: base },
        conversacion,
      );
      conBoost.status = estadoDesdeScore(conBoost.score.total);
      conBoost.debeTransferir = conBoost.score.total >= 65;
      return conBoost;
    } catch (e) {
      const motivo = e instanceof Error ? e.message : 'parse';
      this.logger.warn(`Análisis BANT: fallback heurístico (${motivo}).`);
      return calificacionHeuristica(conversacion);
    }
  }
}

/** FRIO / TIBIO / CALIENTE desde el total 0-100. */
export function estadoDesdeScore(score: number): 'FRIO' | 'TIBIO' | 'CALIENTE' {
  if (score >= 71) return 'CALIENTE';
  if (score >= 41) return 'TIBIO';
  return 'FRIO';
}

/** Mapea el estado del motor al enum de Prisma (FRIO/TIBIO/CALIENTE). */
export function estadoProspectoDesde(
  status: 'FRIO' | 'TIBIO' | 'CALIENTE',
): EstadoLeadProspecto {
  return status as EstadoLeadProspecto;
}

function tieneIntencionCierre(text: string): boolean {
  return /\b(si|sí|ok|dale|de acuerdo|activar|activalo|actívalo|quiero|me interesa|procede|confirmo|comprar|lo llevo)\b/i.test(
    (text || '').toLowerCase(),
  );
}

function normalizarScore(score: Partial<ScoreBant> | undefined): ScoreBant {
  const budget = clamp(score?.budget, 0, 30);
  const authority = clamp(score?.authority, 0, 20);
  const need = clamp(score?.need, 0, 25);
  const timeline = clamp(score?.timeline, 0, 25);
  return {
    budget,
    authority,
    need,
    timeline,
    total: Math.min(100, budget + authority + need + timeline),
  };
}

function clamp(v: unknown, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

interface CalificacionCruda {
  score?: Partial<ScoreBant>;
  status?: string;
  summary?: string;
  keyInsights?: string[];
  nextAction?: string;
}

function parseCalificacionJson(text: string): {
  score: Partial<ScoreBant>;
  resumen: string;
  puntosClave: string[];
  proximaAccion: string;
} {
  const raw = extraerJson(text) as CalificacionCruda;
  return {
    score: raw.score ?? {},
    resumen: raw.summary ?? '',
    puntosClave: Array.isArray(raw.keyInsights) ? raw.keyInsights : [],
    proximaAccion: raw.nextAction ?? '',
  };
}

function extraerJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1]);
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      return JSON.parse(text.slice(first, last + 1));
    }
    throw new Error('JSON inválido');
  }
}

function aplicarBoostCierre(
  parsed: {
    score: ScoreBant;
    resumen: string;
    puntosClave: string[];
    proximaAccion: string;
  },
  conversacion: MensajeConversacion[],
): CalificacionBant {
  const userText = conversacion
    .filter((m) => m.role === 'user')
    .map((m) => m.content.toLowerCase())
    .join(' \n ');

  const acepta = tieneIntencionCierre(userText);
  const dioTelefono = /(?:\+?\d[\d\s-]{6,}\d)/.test(userText);
  const dioNombre = /\b([a-záéíóúñ]{2,}\s+[a-záéíóúñ]{2,})\b/i.test(userText);

  const score: ScoreBant = { ...parsed.score };
  const puntosClave = [...parsed.puntosClave];

  if (acepta) {
    score.need = Math.max(score.need, 22);
    score.timeline = Math.max(score.timeline, 22);
    puntosClave.push('Prospecto confirma intención de avanzar.');
  }
  if (dioTelefono || dioNombre) {
    score.authority = Math.max(score.authority, 16);
    score.need = Math.max(score.need, 23);
    score.timeline = Math.max(score.timeline, 23);
    puntosClave.push('Prospecto comparte datos de contacto para cierre.');
  }
  score.total = Math.min(
    100,
    score.budget + score.authority + score.need + score.timeline,
  );

  return {
    score,
    status: estadoDesdeScore(score.total),
    resumen: parsed.resumen,
    puntosClave,
    proximaAccion: parsed.proximaAccion,
    debeTransferir: score.total >= 65,
  };
}

/** Calificación de respaldo cuando la IA no devuelve un JSON válido. */
function calificacionHeuristica(
  conversacion: MensajeConversacion[],
): CalificacionBant {
  const userText = conversacion
    .filter((m) => m.role === 'user')
    .map((m) => m.content.toLowerCase())
    .join(' \n ');

  const acepta = tieneIntencionCierre(userText);
  const preguntaDiferencia =
    /\b(diferencia|que incluye|qué incluye|que trae|qué trae|precio|cuánto|cuanto)\b/i.test(
      userText,
    );
  const dioTelefono = /(?:\+?\d[\d\s-]{6,}\d)/.test(userText);
  const dioNombre = /\b([a-záéíóúñ]{2,}\s+[a-záéíóúñ]{2,})\b/i.test(userText);

  const score: ScoreBant = {
    budget: 10,
    authority: dioNombre ? 14 : 8,
    need: preguntaDiferencia ? 14 : 10,
    timeline: 8,
    total: 0,
  };
  if (acepta) {
    score.need = 22;
    score.timeline = 22;
  }
  if (dioTelefono) {
    score.authority = 18;
    score.timeline = 24;
  }
  score.total = Math.min(
    100,
    score.budget + score.authority + score.need + score.timeline,
  );

  return {
    score,
    status: estadoDesdeScore(score.total),
    resumen:
      score.total >= 65
        ? 'Prospecto con alta intención de compra y datos de contacto compartidos.'
        : 'Prospecto en evaluación con interés activo.',
    puntosClave: [
      acepta ? 'Confirma intención de avanzar.' : 'Muestra interés comercial.',
      dioTelefono
        ? 'Comparte teléfono para contacto directo.'
        : 'Aún sin cierre de contacto.',
      preguntaDiferencia
        ? 'Pregunta por precio/diferencias.'
        : 'Consulta general de producto.',
    ],
    proximaAccion:
      score.total >= 65
        ? 'Contactar por vendedor humano en menos de 5 minutos para cierre.'
        : 'Profundizar necesidad y presentar propuesta concreta.',
    debeTransferir: score.total >= 65,
  };
}
