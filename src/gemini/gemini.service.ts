import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

@Injectable()
export class GeminiService {
    private readonly logger = new Logger(GeminiService.name);
    private genAI: GoogleGenerativeAI | null = null;
    private model: GenerativeModel | null = null;

    constructor(private readonly configService: ConfigService) {
        const apiKey = this.configService.get<string>('GEMINI_API_KEY');
        if (apiKey) {
            this.genAI = new GoogleGenerativeAI(apiKey);
            // 'gemini-flash-lite-latest' to attempt a fresh quota bucket after 'flash-latest' exhaustion.
            this.model = this.genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });

        } else {
            this.logger.warn('⚠️  GEMINI_API_KEY no configurada. Funciones de IA deshabilitadas.');
        }
    }

    isEnabled(): boolean {
        return !!this.model;
    }

    /**
     * Categoriza una lista de productos, detecta marca y genera descripción
     * @param productos Lista de nombres de productos
     * @returns Mapa de id -> { categoria, marca, descripcion }
     */
    async categorizarProductos(productos: { id: number; nombre: string }[]): Promise<{ id: number; categoria: string; marca: string | null; descripcion: string | null }[]> {
        if (!this.model) {
            throw new Error('Gemini AI no está configurado');
        }

        // Procesar en lotes de 50 para evitar tokens muy largos
        const batchSize = 50;
        const results: { id: number; categoria: string; marca: string | null; descripcion: string | null }[] = [];

        for (let i = 0; i < productos.length; i += batchSize) {
            const batch = productos.slice(i, i + batchSize);

            const prompt = `Eres un experto en materiales de construcción y ferretería en Perú. 
Analiza los siguientes nombres de productos y realizas las siguientes 3 tareas:
1. Asigna una CATEGORÍA apropiada a cada uno (Usa las categorías sugeridas o crea una nueva si es necesario).
2. Detecta la MARCA si está presente en el nombre (si no hay marca clara, usa null).
3. Genera una DESCRIPCIÓN CORTA y vendedora (máx 20 palabras) que resalte el uso o cualidad del producto. No repitas el nombre tal cual.

Categorías comunes para usar:
- CEMENTO Y AGREGADOS
- FIERROS Y ACERO
- LADRILLOS Y BLOQUES
- TUBERIAS Y CONEXIONES PVC
- TUBERIAS Y CONEXIONES AGUA
- PINTURAS Y ACABADOS
- ELECTRICIDAD
- HERRAMIENTAS
- CERRAJERIA
- GASFITERIA
- MADERAS
- TORNILLERIA Y FIJACIONES
- ADHESIVOS Y SELLADORES
- SEGURIDAD INDUSTRIAL
- SANITARIOS
- PISOS Y REVESTIMIENTOS
- TECHOS Y COBERTURAS
- BEBIDAS
- ABARROTES
- LIMPIEZA
- OTROS

Marcas comunes en Perú (pero detecta cualquier marca): 
PAVCO, ETERNIT, TIGRE, SODIMAC, CELIMA, SOL DE ORO, FABER CASTELL, OATEY, TRUPER, STANLEY, BOSCH, MAKITA, DEWALT, BLACK+DECKER, KOLA REAL, INKA KOLA, COCA COLA, GLORIA, LAIVE, etc.

Para cada producto, responde SOLO con el formato JSON exacto (sin markdown, sin explicaciones):
[{"id": 1, "categoria": "CATEGORIA", "marca": "MARCA", "descripcion": "DESCRIPCION GENERADA"}, {"id": 2, "categoria": "CATEGORIA", "marca": null, "descripcion": "DESCRIPCION"}]

Productos a analizar:
${batch.map(p => `- ID: ${p.id}, Nombre: "${p.nombre}"`).join('\n')}

Responde SOLO con el array JSON, nada más.`;

            let batchSuccess = false;
            let retries = 0;

            while (!batchSuccess && retries < 3) {
                try {
                    const result = await this.model.generateContent(prompt);
                    const response = result.response;
                    const text = response.text().trim();

                    // Limpiar posible markdown
                    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

                    try {
                        const parsed = JSON.parse(jsonText);
                        results.push(...parsed);
                    } catch (parseError) {
                        this.logger.error(`Error parseando respuesta de Gemini: ${jsonText}`);
                        // Intentar extraer categorías manualmente o usar fallback
                        batch.forEach(p => {
                            results.push({ id: p.id, categoria: 'OTROS', marca: null, descripcion: p.nombre });
                        });
                    }
                    batchSuccess = true;

                } catch (error: any) {
                    if (error.message.includes('429')) {
                        this.logger.warn(`⚠️ Rate limit excedido (429). Esperando 60 segundos... (Intento ${retries + 1}/3)`);
                        await new Promise(resolve => setTimeout(resolve, 60000));
                        retries++;
                    } else {
                        this.logger.error(`Error llamando a Gemini: ${error.message}`);
                        batch.forEach(p => {
                            results.push({ id: p.id, categoria: 'OTROS', marca: null, descripcion: p.nombre });
                        });
                        break; // Salir del retry si no es 429
                    }
                }
            }

            // Si fallaron todos los reintentos
            if (!batchSuccess && retries >= 3) {
                this.logger.error(`❌ Fallaron todos los reintentos para el lote. Asignando OTROS.`);
                batch.forEach(p => {
                    results.push({ id: p.id, categoria: 'OTROS', marca: null, descripcion: p.nombre });
                });
            }

            // Pausa obligatoria de 4 segundos para respetar ~15 RPM
            if (i + batchSize < productos.length) {
                await new Promise(resolve => setTimeout(resolve, 4000));
            }
        }

        return results;
    }

    /**
     * Chat con el Copiloto de Negocios
     * @param message Pregunta del usuario
     * @param context Contexto del negocio (ventas, productos, etc.)
     * @returns Respuesta generada por la IA
     */
    async chat(message: string, context: any): Promise<string> {
        if (!this.model) {
            return "El asistente IA no está configurado correctamente. Contacta al administrador.";
        }

        const prompt = `
Eres un experto analista de negocios y asistente para dueños de microempresas.
Tu objetivo es ayudar al dueño a entender su negocio basándote en los DATOS que te proporciono.

DATOS DEL NEGOCIO (Contexto Actual):
${JSON.stringify(context, null, 2)}

INSTRUCCIONES DE PERSONALIDAD Y FORMATO:
1.  **Rol:** Eres "Falcon", un socio de negocios inteligente, entusiasta y proactivo. No eres un robot aburrido.
2.  **Tono:** Amigable, profesional pero cercano ("chebre"). Usa emojis 🚀 💡 📈 para dar vida a los datos.
3.  **Formato:**
    *   Usa **negritas** para resaltar montos de dinero (ej: **S/ 1,200**) y nombres de productos.
    *   Usa listas (bullets) para organizar la información.
    *   Sé conciso. Ve al grano, pero con buena onda.
4.  **Contenido:**
    *   Si hay buenas noticias (ventas altas), ¡celébralo! 🎉
    *   Si hay malas noticias (bajo stock), dalo como una alerta útil ⚠️ y sugiere acción inmediata.
    *   Siempre intenta cerrar con una recomendación corta o una pregunta proactiva.

DATOS DEL NEGOCIO (Tu fuente de verdad):
5.  Usa los datos proporcionados para fundamentar tus respuestas. Si no sabes algo, dilo honestamente pero con estilo.
6.  Si te preguntan sobre "qué comprar", revisa los productos con bajo stock.

PREGUNTA DEL USUARIO:
"${message}"

RESPUESTA (Texto plano, sin markdown de código a menos que sea necesario):`;

        try {
            const result = await this.model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            this.logger.error(`Error en chat Gemini: ${error.message}`);
            return `Error técnico (${error.message}). Por favor verifica la API Key y el modelo.`;
        }
    }
    /**
     * Genera una lista de productos realistas basada en un query y rubro
     */
    async generarProductos(rubro: string, query: string): Promise<any[]> {
        if (!this.model) {
            throw new Error('Gemini AI no está configurado');
        }

        const prompt = `
        Eres un experto en gestión de inventarios para negocios en Perú.
        
        CONTEXTO:
        Rubro del negocio: "${rubro}"
        Solicitud del usuario: "${query}"

        TAREA:
        Genera una lista de 10 a 15 productos REALES y ESPECÍFICOS que coincidan con la solicitud.
        
        REQUISITOS OBLIGATORIOS:
        1. **Precios Reales:** Usa precios de mercado peruano (Soles) actuales.
        2. **Marcas Reales:** 
           - Si es Farmacia, usa laboratorios reales (Portugal, Genfar, Bayer, Pfizer, etc.) y marcas comerciales (Panadol, Apronax).
           - Si es Bodega, usa marcas como Gloria, Alicorp, etc.
           - Si es Ferretería, usa Pavco, Aceros Arequipa, etc.
        3. **Formato de Presentación:**
           - Farmacia: "Caja x 100 tabletas", "Frasco 120ml", etc.
           - Bodega: "Botella 500ml", "Paquete 1kg".
        4. **Unidades:** Usa códigos SUNAT si es posible (NIU, CJA, BG, LTR) o genéricos.
        
        FORMATO DE RESPUESTA (JSON PURO ARRAY):
        [
            {
                "nombre": "Nombre completo producto",
                "descripcion": "Presentación y detalles",
                "precioSugerido": 25.50,
                "unidadConteo": "CJA", 
                "categoria": "Categoría sugerida",
                "marca": "Laboratorio/Marca",
                "codigo": "SUGERIDO-001"
            }
        ]
        
        IMPORTANTE: Responde SOLO con el array JSON. Sin markdown, sin explicaciones.
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text().trim();
            // Limpiar markdown
            const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(jsonText);
        } catch (error: any) {
            this.logger.error('Error generando productos con Gemini', error);
            throw new Error('Error generando productos: ' + error.message);
        }
    }

    /**
     * Selecciona la mejor imagen para un producto entre candidatas externas.
     * Devuelve URL elegida o null si Gemini no pudo decidir con confianza.
     */
    async seleccionarMejorImagenProducto(params: {
        nombre: string;
        marca?: string;
        categoria?: string;
        candidatas: Array<{
            url: string;
            title?: string;
            alt?: string;
            width?: number;
            height?: number;
        }>;
    }): Promise<{ url: string; confidence: number; reason?: string } | null> {
        if (!this.model) return null;

        const candidatas = (params.candidatas || [])
            .filter((c) => typeof c.url === 'string' && /^https?:\/\//i.test(c.url))
            .slice(0, 12);

        if (candidatas.length === 0) return null;

        const prompt = `
Eres un asistente experto en selección de imágenes de producto para ecommerce.
Producto objetivo:
- Nombre: "${params.nombre}"
- Marca: "${params.marca || 'No especificada'}"
- Categoría: "${params.categoria || 'No especificada'}"

Tu tarea:
1) Elegir SOLO una candidata (por índice) que represente mejor el producto.
2) Evitar logos, banners, fanart, ilustraciones no relacionadas o imágenes ambiguas.
3) Priorizar fotos reales de producto (packshot), nítidas y comerciales.

Candidatas:
${candidatas
  .map(
    (c, i) =>
      `- index=${i}; title="${(c.title || '').replace(/"/g, "'")}"; alt="${(c.alt || '').replace(/"/g, "'")}"; size=${c.width || 0}x${c.height || 0}; url="${c.url}"`,
  )
  .join('\n')}

Responde SOLO JSON válido (sin markdown):
{"index": 0, "confidence": 0-100, "reason": "breve explicación"}
`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text().trim();
            const cleaned = text
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();

            const parsed = JSON.parse(cleaned) as {
                index?: number;
                confidence?: number;
                reason?: string;
            };

            if (
                typeof parsed.index !== 'number' ||
                parsed.index < 0 ||
                parsed.index >= candidatas.length
            ) {
                return null;
            }

            const confidenceRaw = Number(parsed.confidence ?? 0);
            const confidence = Number.isFinite(confidenceRaw)
                ? Math.max(0, Math.min(100, confidenceRaw))
                : 0;

            return {
                url: candidatas[parsed.index].url,
                confidence,
                reason: parsed.reason || undefined,
            };
        } catch (error: any) {
            this.logger.warn(
                `Gemini no pudo seleccionar imagen candidata: ${error?.message || 'error desconocido'}`,
            );
            return null;
        }
    }
}
