import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StoreCatalogService } from './store-catalog.service';
import {
  CreateStoreProductDto,
  FilterStoreProductDto,
  UpdateStoreProductDto,
} from './dto/store-product.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('store-catalog')
export class StoreCatalogController {
  constructor(private readonly storeCatalogService: StoreCatalogService) {}

  /** Endpoint público — sin autenticación, con filtros via query params */
  @Get('public')
  findAllPublic(@Query() filters: FilterStoreProductDto) {
    return this.storeCatalogService.findAllPublic(filters);
  }

  /** Meta para sidebar: categorías, disponibilidad counts, rango de precios */
  @Get('public/meta')
  getPublicMeta() {
    return this.storeCatalogService.getPublicMeta();
  }

  /** Detalle de un producto (público) */
  @Get('public/:id')
  findOnePublic(@Param('id', ParseIntPipe) id: number) {
    return this.storeCatalogService.findOnePublic(id);
  }

  /** Endpoints protegidos — solo ADMIN_SISTEMA */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Get()
  findAll() {
    return this.storeCatalogService.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Post()
  create(@Body() dto: CreateStoreProductDto) {
    return this.storeCatalogService.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStoreProductDto,
  ) {
    return this.storeCatalogService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.storeCatalogService.remove(id);
  }
}
