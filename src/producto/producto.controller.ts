import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Delete,
} from '@nestjs/common';
import axios from 'axios';
import { ProductoService } from './producto.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import type { Response } from 'express';
import { CreateProductoDto } from './dto/create-producto.dto';
import { ListProductoDto } from './dto/list-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageUploadOptions } from '../common/utils/multer.config';
import { GeminiService } from '../gemini/gemini.service';
import { ProductoLoteService } from './producto-lote.service';
import { CrearLoteDto } from './dto/lote.dto';
import { KardexService } from '../kardex/kardex.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('productos')
export class ProductoController {
  private readonly imageSearchCache = new Map<string, { bestUrl: string; candidates: string[]; cachedAt: number }>();
  private readonly IMAGE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 días

  constructor(
    private readonly service: ProductoService,
    private readonly geminiService: GeminiService,
    private readonly loteService: ProductoLoteService,
    private readonly kardexService: KardexService,
  ) {}

  @Post()
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crear(
    @Body() dto: CreateProductoDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const producto = await this.service.crear(
      dto,
      user.empresaId,
      user.sedeId ?? undefined,
    );
    res.locals.message = 'Producto creado correctamente';
    return producto;
  }

  @Post('ia/categorizar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async categorizarIA(@Body() body: { nombre: string }) {
    if (!this.geminiService) {
      return { success: false, message: 'Gemini Service not available' };
    }
    const result = await this.geminiService.categorizarProductos([
      { id: 0, nombre: body.nombre },
    ]);
    if (result.length > 0) {
      return { success: true, data: result[0] };
    }
    return { success: false, message: 'No se pudo categorizar' };
  }

  @Post('ia/generar-imagen')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async generarImagenIA(
    @Body() body: { nombre: string; marca?: string; categoria?: string },
    @User() user: any,
  ) {
    const nombre = String(body?.nombre || '').trim();
    if (!nombre) {
      return { success: false, message: 'Nombre de producto requerido' };
    }

    const marca = String(body?.marca || '').trim();
    const categoria = String(body?.categoria || '').trim();

    const imagenMemorizada = await this.service.buscarImagenMemorizada(
      user.empresaId,
      nombre,
      marca,
      categoria,
    );
    if (imagenMemorizada?.url) {
      return {
        success: true,
        url: imagenMemorizada.url,
        confidence: 100,
        source: 'MEMORIA_APROBADA',
        message: 'Imagen recuperada desde memoria aprobada de tu empresa.',
        candidates: [imagenMemorizada.url],
      };
    }

    // Cache en memoria (evita llamadas duplicadas a Serper en la misma sesión)
    const cacheKey = `${nombre}|${marca}|${categoria}`.toLowerCase().trim();
    const cached = this.imageSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.IMAGE_CACHE_TTL) {
      void this.service.guardarImagenMemorizada({ empresaId: user.empresaId, nombre, marca, categoria, url: cached.bestUrl }).catch(() => {});
      return {
        success: true,
        url: cached.bestUrl,
        confidence: 80,
        source: 'CACHE',
        message: 'Imagen recuperada desde caché.',
        candidates: cached.candidates,
      };
    }

    const normalize = (text: string) =>
      text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const stopWords = new Set([
      'de',
      'con',
      'sin',
      'para',
      'por',
      'the',
      'and',
      'del',
      'la',
      'el',
      'los',
      'las',
      'producto',
      'pack',
      'shot',
      'foto',
      'imagen',
    ]);
    const typoAliases: Record<string, string> = {
      qatey: 'oatey',
    };
    const canonicalToken = (token: string) => typoAliases[token] || token;

    const oneEditAway = (a: string, b: string) => {
      if (a === b) return true;
      if (Math.abs(a.length - b.length) > 1) return false;
      const s1 = a.length <= b.length ? a : b;
      const s2 = a.length <= b.length ? b : a;
      let i = 0;
      let j = 0;
      let edits = 0;
      while (i < s1.length && j < s2.length) {
        if (s1[i] === s2[j]) {
          i += 1;
          j += 1;
          continue;
        }
        edits += 1;
        if (edits > 1) return false;
        if (s1.length === s2.length) {
          i += 1;
          j += 1;
        } else {
          j += 1;
        }
      }
      if (i < s1.length || j < s2.length) edits += 1;
      return edits <= 1;
    };

    const contextRaw = [nombre, marca, categoria].filter(Boolean).join(' ');
    const baseTokens = normalize(contextRaw)
      .split(' ')
      .map(canonicalToken)
      .filter((t) => t.length >= 3 && !stopWords.has(t));
    const tokenSet = new Set(baseTokens);

    if (tokenSet.size < 1) {
      return {
        success: false,
        message:
          'Descripción muy corta. Usa al menos 1 palabra para buscar imagen relevante.',
      };
    }

    const bannedWords = [
      'logo',
      'icon',
      'svg',
      'vector',
      'clipart',
      'sticker',
      'wallpaper',
      'banner',
      'facebook',
      'instagram',
      'tiktok',
      'pinterest',
      'youtube',
      'anime',
      'manga',
      'fanart',
    ];

    type ImageResult = {
      url?: string;
      title?: string;
      alt?: string;
      width?: number;
      height?: number;
    };

    const scoreImage = (
      img: ImageResult,
    ): { score: number; tokenMatches: number } => {
      const sourceText = normalize(
        `${img.title || ''} ${img.alt || ''} ${img.url || ''}`,
      );
      if (!sourceText) return { score: -1000, tokenMatches: 0 };
      const words = sourceText.split(' ').filter(Boolean);

      let score = 0;
      let tokenMatches = 0;
      for (const token of tokenSet) {
        if (sourceText.includes(token)) {
          score += 6;
          tokenMatches += 1;
          continue;
        }
        const similar = words.some(
          (w) => w.length >= 4 && oneEditAway(w, token),
        );
        if (similar) {
          score += 3;
          tokenMatches += 1;
        }
      }
      for (const banned of bannedWords) {
        if (sourceText.includes(banned)) score -= 12;
      }

      const lowerUrl = String(img.url || '').toLowerCase();
      if (lowerUrl.endsWith('.svg')) score -= 20;
      if (lowerUrl.includes('logo') || lowerUrl.includes('icon')) score -= 10;

      if ((img.width || 0) >= 400 && (img.height || 0) >= 400) score += 4;
      if ((img.width || 0) < 180 || (img.height || 0) < 180) score -= 8;
      if (sourceText.includes('pegamento') || sourceText.includes('adhesive'))
        score += 3;
      if (sourceText.includes('transparente') || sourceText.includes('clear'))
        score += 2;
      if (tokenSet.has('oatey') && sourceText.includes('oatey')) score += 4;

      return { score, tokenMatches };
    };

    // Helper: normaliza resultados de cualquier proveedor y los acumula
    const processImageResults = (
      rawImages: ImageResult[],
      rankedByUrl: Map<string, any>,
      curatedGlobal: Set<string>,
    ): { bestLocal: { url: string; score: number; tokenMatches: number } | null; curated: string[] } => {
      const candidates = rawImages
        .filter((img) => !!img?.url && /^https?:\/\//i.test(String(img.url)))
        .map((img) => {
          const ranking = scoreImage(img);
          return { img, score: ranking.score, tokenMatches: ranking.tokenMatches };
        })
        .sort((a, b) => b.score - a.score);

      for (const c of candidates) {
        if (!c.img.url) continue;
        const url = String(c.img.url);
        const prev = rankedByUrl.get(url);
        if (!prev || c.score > prev.score) {
          rankedByUrl.set(url, { url, title: c.img.title, alt: c.img.alt, width: c.img.width, height: c.img.height, score: c.score, tokenMatches: c.tokenMatches });
        }
      }

      const curatedList = candidates
        .filter((c) => c.score > 0 && c.tokenMatches >= 1 && c.img.url)
        .slice(0, 4)
        .map((c) => String(c.img.url))
        .filter((url) => !url.toLowerCase().endsWith('.svg'));
      for (const url of curatedList) curatedGlobal.add(url);

      const best = candidates[0];
      return {
        bestLocal: best?.img?.url ? { url: String(best.img.url), score: best.score, tokenMatches: best.tokenMatches } : null,
        curated: curatedList,
      };
    };

    try {
      const canonicalName = normalize(nombre).split(' ').map(canonicalToken).join(' ');
      const canonicalBrand = normalize(marca).split(' ').map(canonicalToken).join(' ');
      const canonicalCategory = normalize(categoria).split(' ').map(canonicalToken).join(' ');
      const queryContext = [canonicalName, canonicalBrand, canonicalCategory].filter(Boolean).join(' ').trim();

      const queries = Array.from(
        new Set(
          [
            `${queryContext} producto`,
            `${queryContext} foto producto`,
            `${queryContext} packshot`,
          ].filter((q) => q.trim().length > 0),
        ),
      );

      let bestGlobal: { url: string; score: number; tokenMatches: number } | null = null;
      const curatedGlobal = new Set<string>();
      const rankedByUrl = new Map<string, { url: string; title?: string; alt?: string; width?: number; height?: number; score: number; tokenMatches: number }>();

      for (const query of queries) {
        // Provider 1: Serper (Google Images real, 2500 gratis sin CC)
        const serperKey = process.env.SERPER_API_KEY;
        if (serperKey) {
          try {
            const serperResp = await axios.post(
              'https://google.serper.dev/images',
              { q: query, gl: 'pe', hl: 'es', num: 10 },
              { headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' }, timeout: 10000 },
            );
            const serperImages: ImageResult[] = ((serperResp.data as any)?.images || []).map((img: any) => ({
              url: img?.imageUrl || '',
              title: img?.title || '',
              alt: img?.title || '',
              width: Number(img?.imageWidth || 0) || undefined,
              height: Number(img?.imageHeight || 0) || undefined,
            }));
            const { bestLocal } = processImageResults(serperImages, rankedByUrl, curatedGlobal);
            if (bestLocal && (!bestGlobal || bestLocal.score > bestGlobal.score)) bestGlobal = bestLocal;
            if (bestLocal && bestLocal.score >= 6 && bestLocal.tokenMatches >= 1) break;
          } catch {
            // Continuar con siguiente provider
          }
        }

        // Provider 2: Google Custom Search JSON API (gratis 100/día)
        const cseApiKey = process.env.GOOGLE_CSE_API_KEY;
        const cseCx = process.env.GOOGLE_CSE_CX;
        if (cseApiKey && cseCx) {
          try {
            const cseResp = await axios.get('https://www.googleapis.com/customsearch/v1', {
              params: { key: cseApiKey, cx: cseCx, searchType: 'image', q: query, num: 10, imgType: 'photo', safe: 'medium', gl: 'pe', hl: 'es' },
              timeout: 10000,
            });
            const cseItems: any[] = Array.isArray((cseResp.data as any)?.items) ? (cseResp.data as any).items : [];
            const cseImages: ImageResult[] = cseItems.map((item: any) => ({
              url: item?.link || '',
              title: item?.title || '',
              alt: item?.snippet || '',
              width: Number(item?.image?.width || 0) || undefined,
              height: Number(item?.image?.height || 0) || undefined,
            }));
            const { bestLocal } = processImageResults(cseImages, rankedByUrl, curatedGlobal);
            if (bestLocal && (!bestGlobal || bestLocal.score > bestGlobal.score)) bestGlobal = bestLocal;
            if (bestLocal && bestLocal.score >= 6 && bestLocal.tokenMatches >= 1) break;
          } catch {
            // Continuar con siguiente provider
          }
        }

        // Provider 2: Brave Image Search API
        const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;
        if (braveApiKey) {
          try {
            const braveResp = await axios.get('https://api.search.brave.com/res/v1/images/search', {
              params: { q: query, count: 20, country: 'PE', search_lang: 'es', safesearch: 'strict', spellcheck: true },
              headers: { 'X-Subscription-Token': braveApiKey },
              timeout: 10000,
            });
            const braveItems: any[] = Array.isArray((braveResp.data as any)?.results) ? (braveResp.data as any).results : [];
            const braveImages: ImageResult[] = braveItems.map((item: any) => ({
              url: item?.properties?.url || item?.url || item?.thumbnail?.src || '',
              title: item?.title || item?.page_title || '',
              alt: item?.description || item?.alt || '',
              width: Number(item?.properties?.width || item?.width || 0) || undefined,
              height: Number(item?.properties?.height || item?.height || 0) || undefined,
            }));
            const { bestLocal } = processImageResults(braveImages, rankedByUrl, curatedGlobal);
            if (bestLocal && (!bestGlobal || bestLocal.score > bestGlobal.score)) bestGlobal = bestLocal;
          } catch {
            // Continuar
          }
        }

        // Provider 3: Pixabay (gratis 5000/hora, sin CC — imágenes genéricas de producto)
        const pixabayKey = process.env.PIXABAY_API_KEY;
        if (pixabayKey) {
          try {
            const pixabayResp = await axios.get('https://pixabay.com/api/', {
              params: { key: pixabayKey, q: query, image_type: 'photo', per_page: 10, safesearch: true, lang: 'es' },
              timeout: 8000,
            });
            const pixabayHits: any[] = Array.isArray((pixabayResp.data as any)?.hits) ? (pixabayResp.data as any).hits : [];
            const pixabayImages: ImageResult[] = pixabayHits.map((hit: any) => ({
              url: hit?.largeImageURL || hit?.webformatURL || '',
              title: hit?.tags || '',
              alt: hit?.tags || '',
              width: Number(hit?.imageWidth || hit?.webformatWidth || 0) || undefined,
              height: Number(hit?.imageHeight || hit?.webformatHeight || 0) || undefined,
            }));
            const { bestLocal } = processImageResults(pixabayImages, rankedByUrl, curatedGlobal);
            if (bestLocal && (!bestGlobal || bestLocal.score > bestGlobal.score)) bestGlobal = bestLocal;
          } catch {
            // Continuar
          }
        }
      }

      // Helper para guardar resultado en caché en memoria + DB automáticamente
      const guardarEnCache = (url: string, candidates: string[]) => {
        this.imageSearchCache.set(cacheKey, { bestUrl: url, candidates, cachedAt: Date.now() });
        void this.service.guardarImagenMemorizada({ empresaId: user.empresaId, nombre, marca, categoria, url }).catch(() => {});
      };

      // Gemini decide la mejor candidata (si está disponible), usando las mejores heurísticas.
      const rankedGlobalList = Array.from(rankedByUrl.values()).sort(
        (a, b) => b.score - a.score,
      );
      if (this.geminiService?.isEnabled() && rankedGlobalList.length > 0) {
        const geminiChoice =
          await this.geminiService.seleccionarMejorImagenProducto({
            nombre,
            marca,
            categoria,
            candidatas: rankedGlobalList.slice(0, 10).map((c) => ({
              url: c.url,
              title: c.title,
              alt: c.alt,
              width: c.width,
              height: c.height,
            })),
          });

        if (geminiChoice?.url) {
          const globalCandidates = Array.from(curatedGlobal).slice(0, 5);
          const candidates = globalCandidates.length > 0 ? globalCandidates : [geminiChoice.url];
          guardarEnCache(geminiChoice.url, candidates);
          return {
            success: true,
            url: geminiChoice.url,
            confidence: geminiChoice.confidence,
            message: geminiChoice.reason || 'Imagen seleccionada por Gemini.',
            candidates,
          };
        }
      }

      const globalCandidates = Array.from(curatedGlobal).slice(0, 5);
      if (bestGlobal?.url && bestGlobal.score >= 6) {
        const candidates = globalCandidates.length > 0 ? globalCandidates : [bestGlobal.url];
        guardarEnCache(bestGlobal.url, candidates);
        return {
          success: true,
          url: bestGlobal.url,
          confidence: bestGlobal.score,
          candidates,
          message: 'Imagen encontrada.',
        };
      }

      if (globalCandidates.length > 0) {
        guardarEnCache(globalCandidates[0], globalCandidates);
        return {
          success: false,
          message: 'No hubo coincidencia exacta, pero encontré opciones sugeridas.',
          candidates: globalCandidates,
        };
      }

      return {
        success: false,
        message: 'No se encontraron imágenes suficientemente relacionadas para este producto.',
        candidates: [],
      };
    } catch (e: any) {
      return {
        success: false,
        message:
          e.message || 'No se encontró una imagen suficientemente relacionada.',
        candidates: [],
      };
    }
  }

  @Post('ia/aprobar-imagen')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async aprobarImagenIA(
    @Body()
    body: { nombre: string; marca?: string; categoria?: string; url: string },
    @User() user: any,
  ) {
    const nombre = String(body?.nombre || '').trim();
    const marca = String(body?.marca || '').trim();
    const categoria = String(body?.categoria || '').trim();
    const url = String(body?.url || '').trim();

    if (!nombre) {
      throw new BadRequestException(
        'Nombre de producto requerido para aprobar imagen.',
      );
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new BadRequestException('URL de imagen no válida.');
    }

    await this.service.guardarImagenMemorizada({
      empresaId: user.empresaId,
      nombre,
      marca,
      categoria,
      url,
    });

    return {
      success: true,
      message: 'Imagen aprobada y guardada para próximas búsquedas.',
      data: { url },
    };
  }

  // ==================== IMÁGENES (S3) ====================

  @Post(':id/imagen')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async subirImagenPrincipal(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.subirImagenPrincipal(user.empresaId, id, {
      buffer: file?.buffer,
      mimetype: file?.mimetype,
    });
  }

  @Post(':id/imagen-extra')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async subirImagenExtra(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.subirImagenExtra(user.empresaId, id, {
      buffer: file?.buffer,
      mimetype: file?.mimetype,
    });
  }

  @Post(':id/imagen-url')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async subirImagenDesdeUrl(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Body() body: { url: string },
  ) {
    return this.service.subirImagenDesdeUrl(user.empresaId, id, body.url);
  }

  // Sube una imagen y la aplica a todas las tallas del color (una sola foto por color)
  @Post(':id/imagen-color')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async subirImagenColor(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { color: string },
  ) {
    return this.service.subirImagenColorVariantes(user.empresaId, id, body.color, {
      buffer: file?.buffer,
      mimetype: file?.mimetype,
    });
  }

  // Catálogo optimizado para POS farmacia/botica/droguería — con FEFO, vencimientos y receta
  @Get('catalogo-farmacia')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async catalogoFarmacia(
    @User() user: any,
    @Query('sedeId') sedeId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('categoriaId') categoriaId?: string,
  ) {
    const resolvedSedeId = sedeId ? Number(sedeId) : user.sedeId;
    if (!resolvedSedeId) throw new Error('sedeId es requerido');
    return this.service.catalogoFarmacia({
      empresaId: user.empresaId,
      sedeId: resolvedSedeId,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      search,
      categoriaId: categoriaId ? Number(categoriaId) : undefined,
    });
  }

  // Literales primero — siempre antes que :id para evitar conflictos de matching
  @Get('ficha-tecnica/plantilla')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerPlantillaFichaTecnica(
    @User() user: any,
    @Query('categoriaId') categoriaId?: string,
    @Query('descripcion') descripcion?: string,
    @Query('tipoProducto') tipoProducto?: string,
  ) {
    return this.service.obtenerPlantillaFichaTecnica(user.empresaId, {
      categoriaId: categoriaId ? Number(categoriaId) : undefined,
      descripcion,
      tipoProducto,
    });
  }

  @Get('ficha-tecnica/plantillas')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listarPlantillasFichaTecnica(@User() user: any) {
    return this.service.listarPlantillasFichaTecnica(user.empresaId);
  }

  @Post('ficha-tecnica/plantillas')
  @Roles('ADMIN_EMPRESA')
  async guardarPlantillaFichaTecnica(@User() user: any, @Body() body: any) {
    return this.service.guardarPlantillaFichaTecnica(user.empresaId, body);
  }

  @Put('ficha-tecnica/plantillas/:id')
  @Roles('ADMIN_EMPRESA')
  async actualizarPlantillaFichaTecnica(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.service.guardarPlantillaFichaTecnica(user.empresaId, { ...body, id });
  }

  @Get()
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listar(
    @User() user: any,
    @Query() query: ListProductoDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isAdmin = user.rol === 'ADMIN_EMPRESA' || user.rol === 'ADMIN_SISTEMA';
    const sedeId = isAdmin
      ? query.sedeId ? Number(query.sedeId) : null
      : user.sedeId;
    const resultado = await this.service.listar({
      empresaId: user.empresaId,
      sedeId,
      search: query.search,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
      marcaId: query.marcaId,
      categoriaId: query.categoriaId,
    });
    res.locals.message = 'Productos listados correctamente';
    return resultado;
  }

  @Get('codigo-siguiente')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async codigoSiguiente(@User() user: any) {
    const codigo = await this.service.obtenerSiguienteCodigo(user.empresaId, 'PR');
    return { codigo };
  }

  @Get('exportar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async exportar(
    @User() user: any,
    @Query('search') search: string | undefined,
    @Res() res: Response,
  ) {
    const buffer = await this.service.exportar(user.empresaId, search);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=productos.xlsx');
    res.status(200).send(buffer);
  }

  @Get('plantilla')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async plantilla(@Res() res: Response) {
    const buffer = await this.service.plantilla();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_productos.xlsx');
    res.status(200).send(buffer);
  }

  @Get('barcode/:codigo')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async getByBarcode(
    @Param('codigo') codigo: string,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const producto = await this.service.getByBarcode(user.empresaId, codigo);
    res.locals.message = 'Producto obtenido por código de barras';
    return producto;
  }

  @Delete('eliminar-todo')
  @Roles('ADMIN_EMPRESA')
  async eliminarTodo(
    @User() user: any,
    @Query('sedeId') sedeId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sedeIdNum = sedeId ? parseInt(sedeId, 10) : undefined;
    const eliminados = await this.service.eliminarTodo(user.empresaId, sedeIdNum);
    res.locals.message = `Se eliminaron (lógicamente) ${eliminados.count} productos correctamente`;
    return eliminados;
  }

  // Rutas con parámetros dinámicos al final
  @Get(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerPorId(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const producto = await this.service.obtenerPorId(id, user.empresaId);
    res.locals.message = 'Producto obtenido correctamente';
    return producto;
  }

  @Put(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Body() body: Omit<UpdateProductoDto, 'id' | 'empresaId'>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const actualizado = await this.service.actualizar(
      {
        id,
        empresaId: user.empresaId,
        sedeId: user.sedeId ?? undefined,
        ...body,
      },
      user.id,
    );
    res.locals.message = 'Producto actualizado correctamente';
    return actualizado;
  }

  @Patch(':id/publicar-tienda')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async togglePublicarEnTienda(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Body() body: { publicarEnTienda: boolean },
  ) {
    return this.service.togglePublicarEnTienda(id, user.empresaId, body.publicarEnTienda);
  }

  @Patch(':id/estado')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Body() body: { estado: 'ACTIVO' | 'INACTIVO' | 'PLACEHOLDER' },
    @Res({ passthrough: true }) res: Response,
  ) {
    const actualizado = await this.service.cambiarEstado(id, user.empresaId, body.estado as any);
    res.locals.message = `Producto ${body.estado === 'ACTIVO' ? 'activado' : body.estado === 'INACTIVO' ? 'desactivado' : 'actualizado'} correctamente`;
    return actualizado;
  }

  @Delete(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async eliminarProducto(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const eliminado = await this.service.eliminar(id, user.empresaId);
    res.locals.message = 'Producto eliminado correctamente';
    return eliminado;
  }

  @Post('importar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  @UseInterceptors(FileInterceptor('file'))
  async cargarMasivo(@UploadedFile() file: any, @User() user: any) {
    if (!file) {
      return { total: 0, exitosos: 0, fallidos: 0, detalles: [{ error: 'No se proporcionó un archivo Excel' }] };
    }
    return this.service.cargaMasiva(file.buffer, user.empresaId);
  }

  // ==================== GESTIÓN DE LOTES (Farmacia) ====================

  @Get(':id/lotes')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerLotesProducto(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
  ) {
    return this.loteService.obtenerLotesProducto(id, user.empresaId);
  }

  @Get(':id/lotes/disponibles')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerLotesDisponibles(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
  ) {
    return this.loteService.obtenerLotesDisponibles(id, user.empresaId);
  }

  @Post('lotes')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crearLote(
    @Body() dto: CrearLoteDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const lote = await this.loteService.crearLote({
      ...dto,
      empresaId: user.empresaId,
      fechaVencimiento: new Date(dto.fechaVencimiento),
      usuarioId: user.id,
    });
    res.locals.message = 'Lote creado correctamente';
    return lote;
  }

  @Get('lotes/por-vencer')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerProductosPorVencer(
    @User() user: any,
    @Query('dias') dias?: string,
  ) {
    const diasAnticipacion = dias ? parseInt(dias) : 30;
    return this.loteService.obtenerProductosPorVencer(
      user.empresaId,
      diasAnticipacion,
    );
  }

  @Get('lotes/vencidos')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerLotesVencidos(@User() user: any) {
    return this.loteService.obtenerLotesVencidos(user.empresaId);
  }

  @Patch('lotes/:id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async actualizarLote(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      lote?: string;
      fechaVencimiento?: string;
      costoUnitario?: number;
      proveedor?: string;
    },
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data: any = {};
    if (body.lote !== undefined) data.lote = body.lote;
    if (body.fechaVencimiento !== undefined)
      data.fechaVencimiento = new Date(body.fechaVencimiento);
    if (body.costoUnitario !== undefined)
      data.costoUnitario = body.costoUnitario;
    if (body.proveedor !== undefined) data.proveedor = body.proveedor;
    const result = await this.loteService.actualizarLote(
      id,
      user.empresaId,
      data,
    );
    res.locals.message = 'Lote actualizado correctamente';
    return result;
  }

  @Patch('lotes/:id/desactivar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async desactivarLote(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.loteService.desactivarLote(id, user.empresaId, user.id);
    res.locals.message = 'Lote desactivado correctamente';
    return { success: true };
  }

  @Patch('lotes/:id/ajustar-stock')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async ajustarStockLote(
    @Param('id', ParseIntPipe) loteId: number,
    @Body()
    body: {
      productoId: number;
      cantidad: number;
      tipo: 'INCREMENTO' | 'DECREMENTO';
      motivo: string;
    },
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (body.cantidad <= 0)
      throw new BadRequestException('Cantidad debe ser positiva');

    const tipoMovimiento = body.tipo === 'INCREMENTO' ? 'INGRESO' : 'SALIDA';

    // Obtener sede principal
    const sedePrincipal = await this.service.getSedePrincipalId(user.empresaId);

    // 1. Registrar movimiento global (Kardex)
    const movimiento = await this.kardexService.registrarMovimiento({
      productoId: body.productoId,
      empresaId: user.empresaId,
      tipoMovimiento: tipoMovimiento,
      concepto: `Ajuste Lote Manual: ${body.motivo}`,
      cantidad: body.cantidad,
      usuarioId: user.id,
      // Usar la sede del usuario si está disponible o la principal
      sedeId: user.sedeId || sedePrincipal,
    });

    // 2. Ajustar lote específico
    if (body.tipo === 'INCREMENTO') {
      await this.loteService.aumentarStockLote(
        loteId,
        body.cantidad,
        movimiento.id,
      );
    } else {
      // Usamos descontarStockLote pasando el ID explícito para que no haga FEFO, sino descuento a ESE lote.
      await this.loteService.descontarStockLote(
        body.productoId,
        body.cantidad,
        movimiento.id,
        loteId,
      );
    }

    res.locals.message = 'Stock ajustado correctamente';
    return { success: true };
  }

  @Get('lotes/:id/kardex')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerKardexLote(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
  ) {
    return this.loteService.obtenerKardexLote(id, user.empresaId);
  }

  @Get('lotes/todos')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listarLotesActivos(
    @User() user: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('estado') estado?: 'TODOS' | 'VIGENTE' | 'POR_VENCER' | 'VENCIDO',
  ) {
    return this.loteService.obtenerLotesConFiltros({
      empresaId: user.empresaId,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      search,
      estado: estado ?? 'TODOS',
    });
  }
}
