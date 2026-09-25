import { Controller, Get, Post, Body, Param, Query, Ip } from '@nestjs/common';
import { TiendaService } from './tienda.service';
import { CrearPedidoDto } from './dto/crear-pedido.dto';
import { ModificadoresService } from '../modificadores/modificadores.service';
import { MercadoPagoService } from '../mercadopago/mercadopago.service';
import { NiubizService } from '../niubiz/niubiz.service';

@Controller('public/store')
export class TiendaPublicController {
  constructor(
    private readonly tiendaService: TiendaService,
    private readonly modificadoresService: ModificadoresService,
    private readonly mercadoPago: MercadoPagoService,
    private readonly niubiz: NiubizService,
  ) {}

  @Get(':slug')
  async obtenerTienda(@Param('slug') slug: string) {
    return this.tiendaService.obtenerTiendaPorSlug(slug);
  }

  @Get(':slug/products')
  async obtenerProductos(
    @Param('slug') slug: string,
    @Query('page') page = '1',
    @Query('limit') limit = '30',
    @Query('search') search = '',
    @Query('category') category = '',
    @Query('minPrice') minPrice = '',
    @Query('maxPrice') maxPrice = '',
    @Query('brand') brand = '',
    @Query('wholesale') wholesale = '',
    @Query('atributos') atributos = '',
  ) {
    const min =
      minPrice && !isNaN(Number(minPrice)) ? Number(minPrice) : undefined;
    const max =
      maxPrice && !isNaN(Number(maxPrice)) ? Number(maxPrice) : undefined;
    const isWholesale = wholesale === 'true';

    return this.tiendaService.obtenerProductosTienda(
      slug,
      Number(page) || 1,
      Number(limit) || 30,
      search,
      category,
      min,
      max,
      brand,
      isWholesale,
      atributos,
    );
  }

  @Get(':slug/categories')
  async obtenerCategorias(@Param('slug') slug: string) {
    return this.tiendaService.obtenerCategoriasTienda(slug);
  }

  @Get(':slug/brands')
  async obtenerMarcas(@Param('slug') slug: string) {
    return this.tiendaService.obtenerMarcasTienda(slug);
  }

  @Get(':slug/price-range')
  async obtenerRangoPrecios(@Param('slug') slug: string) {
    return this.tiendaService.obtenerRangoPreciosTienda(slug);
  }

  @Get(':slug/products/:id')
  async obtenerProductoDetalle(
    @Param('slug') slug: string,
    @Param('id') id: string,
  ) {
    return this.tiendaService.obtenerProductoDetalle(slug, +id);
  }

  @Get(':slug/products/:id/reviews')
  async listarReviewsProducto(
    @Param('slug') slug: string,
    @Param('id') id: string,
  ) {
    return this.tiendaService.listarReviewsPublicas(slug, +id);
  }

  @Post(':slug/products/:id/reviews')
  async crearReviewProducto(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.tiendaService.crearReviewPublica(slug, +id, dto);
  }

  @Get(':slug/products/:id/related')
  async obtenerProductosRelacionados(
    @Param('slug') slug: string,
    @Param('id') id: string,
  ) {
    return this.tiendaService.obtenerProductosRelacionados(slug, +id);
  }

  @Get(':slug/payment-config')
  async obtenerConfiguracionPago(@Param('slug') slug: string) {
    return this.tiendaService.obtenerConfiguracionPago(slug);
  }

  @Get(':slug/shipping-config')
  async obtenerConfiguracionEnvio(@Param('slug') slug: string) {
    return this.tiendaService.obtenerConfiguracionEnvioPublica(slug);
  }

  @Get('track/:codigo')
  async rastrearPedido(@Param('codigo') codigo: string) {
    return this.tiendaService.obtenerPedidoPorCodigo(codigo);
  }

  // Respaldo al volver de Mercado Pago (back_url trae payment_id/collection_id):
  // consulta el pago con el token de la empresa y confirma el pedido si fue aprobado.
  @Get('track/:codigo/mp-sync')
  async sincronizarMercadoPago(
    @Param('codigo') codigo: string,
    @Query('payment_id') paymentId?: string,
    @Query('collection_id') collectionId?: string,
  ) {
    return this.mercadoPago.sincronizarPagoRetorno(
      codigo,
      paymentId || collectionId || undefined,
    );
  }

  // ==================== COMBOS ====================

  @Get(':slug/combos')
  async obtenerCombos(@Param('slug') slug: string) {
    return this.tiendaService.obtenerCombosTienda(slug);
  }

  @Get(':slug/combos/:id')
  async obtenerComboDetalle(
    @Param('slug') slug: string,
    @Param('id') id: string,
  ) {
    return this.tiendaService.obtenerComboDetalle(slug, +id);
  }

  @Get(':slug/combos/:id/stock')
  async verificarStockCombo(
    @Param('slug') slug: string,
    @Param('id') id: string,
  ) {
    return this.tiendaService.verificarStockCombo(slug, +id);
  }

  // ==================== MODIFICADORES ====================

  @Get(':slug/products/:id/modifiers')
  async obtenerModificadoresProducto(
    @Param('slug') slug: string,
    @Param('id') id: string,
  ) {
    // slug se usa para validar que el producto pertenece a esa tienda
    return this.modificadoresService.obtenerModificadoresProductoPublico(+id);
  }

  // ==================== PEDIDOS ====================

  /**
   * Abre la sesión de Niubiz para que el navegador pueda mostrar el formulario
   * de tarjeta. Devuelve solo lo público: nunca la clave del comercio.
   */
  @Post(':slug/niubiz/session')
  async crearSesionNiubiz(
    @Param('slug') slug: string,
    @Body() body: { total: number },
    @Ip() ip: string,
  ) {
    const empresaId = await this.tiendaService.obtenerEmpresaIdPorSlug(slug);
    return this.niubiz.crearSesion({
      empresaId,
      montoSoles: Number(body?.total),
      clientIp: ip,
    });
  }

  @Post(':slug/orders')
  async crearPedido(@Param('slug') slug: string, @Body() dto: CrearPedidoDto) {
    return this.tiendaService.crearPedido(slug, dto);
  }
}
