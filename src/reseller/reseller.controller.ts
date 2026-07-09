import {
  Controller,
  Delete,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  ParseIntPipe,
  Patch,
  Query,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ResellerService } from './reseller.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageUploadOptions } from 'src/common/utils/multer.config';

@Controller('resellers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ResellerController {
  constructor(private readonly resellerService: ResellerService) {}

  @Roles('ADMIN_SISTEMA')
  @Post()
  create(@Body() createDto: any) {
    return this.resellerService.create(createDto);
  }

  @Roles('ADMIN_SISTEMA')
  @Get()
  findAll() {
    return this.resellerService.findAll();
  }

  @Roles('ADMIN_SISTEMA')
  @Get('rentabilidad')
  getProfitabilityOverview(@Query('days') days?: string) {
    const period = Number(days ?? 30);
    return this.resellerService.getProfitabilityOverview(
      Number.isFinite(period) ? period : 30,
    );
  }

  @Roles('ADMIN_SISTEMA')
  @Post('renewals/run')
  runRenewalsNow() {
    return this.resellerService.processMonthlyRenewals();
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.findOne(id);
  }

  @Roles('ADMIN_SISTEMA')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.resellerService.update(id, body);
  }

  @Roles('ADMIN_SISTEMA')
  @Patch(':id/estado')
  toggleEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { activo: boolean },
  ) {
    return this.resellerService.toggleActiveStatus(id, body.activo);
  }

  @Roles('ADMIN_SISTEMA')
  @Post(':id/recargar')
  recargar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { monto: number; referencia?: string },
    @Request() req: any,
  ) {
    const usuarioId = req.user.id;
    return this.resellerService.recargarSaldo(
      id,
      body.monto,
      usuarioId,
      body.referencia,
    );
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Get(':id/dashboard')
  async getDashboard(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.getDashboardStats(id);
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Get(':id/renovaciones')
  async getRenewalMovements(
    @Param('id', ParseIntPipe) id: number,
    @Query('estado') estado: string | undefined,
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.getRenewalMovements(id, estado);
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Get(':id/estado-cuenta')
  async getEstadoCuenta(
    @Param('id', ParseIntPipe) id: number,
    @Query('desde') desde: string | undefined,
    @Query('hasta') hasta: string | undefined,
    @Query('tipo') tipo: string | undefined,
    @Query('estado') estado: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.getEstadoCuenta(id, {
      desde,
      hasta,
      tipo,
      estado,
      page: Number(page ?? 1),
      limit: Number(limit ?? 50),
    });
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Post(':id/upload-logo')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async uploadLogo(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    const url = await this.resellerService.uploadLogo(id, file);
    return { url };
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Post(':id/clientes')
  async createClient(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.createClient(id, body);
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Get(':id/consultar-documento')
  async consultarDocumento(
    @Param('id', ParseIntPipe) id: number,
    @Query('tipo') tipo: 'DNI' | 'RUC',
    @Query('numero') numero: string,
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.consultarDocumento(numero, tipo);
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Get(':id/clientes/:clienteId')
  async getClientDetails(
    @Param('id', ParseIntPipe) id: number,
    @Param('clienteId', ParseIntPipe) clienteId: number,
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.getClientDetails(id, clienteId);
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Patch(':id/clientes/:clienteId/estado')
  async toggleClientStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('clienteId', ParseIntPipe) clienteId: number,
    @Body() body: { estado: 'ACTIVO' | 'INACTIVO' },
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.toggleClientStatus(id, clienteId, body.estado);
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Delete(':id/clientes/:clienteId')
  async deleteDemoClient(
    @Param('id', ParseIntPipe) id: number,
    @Param('clienteId', ParseIntPipe) clienteId: number,
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.deleteDemoClient(id, clienteId);
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Patch(':id/clientes/:clienteId')
  async updateClient(
    @Param('id', ParseIntPipe) id: number,
    @Param('clienteId', ParseIntPipe) clienteId: number,
    @Body() body: any,
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.updateClient(id, clienteId, body);
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Patch(':id/clientes/:clienteId/config')
  async updateClientConfig(
    @Param('id', ParseIntPipe) id: number,
    @Param('clienteId', ParseIntPipe) clienteId: number,
    @Body() body: any,
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.updateClientConfig(id, clienteId, body);
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Patch(':id/clientes/:clienteId/ambiente')
  async updateClientAmbiente(
    @Param('id', ParseIntPipe) id: number,
    @Param('clienteId', ParseIntPipe) clienteId: number,
    @Body() body: { usaDemo: boolean },
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.updateClientAmbiente(
      id,
      clienteId,
      body.usaDemo,
    );
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Get(':id/clientes/:clienteId/series')
  async getClientSeries(
    @Param('id', ParseIntPipe) id: number,
    @Param('clienteId', ParseIntPipe) clienteId: number,
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.getClientSeries(id, clienteId);
  }

  @Roles('ADMIN_SISTEMA', 'RESELLER')
  @Patch(':id/clientes/:clienteId/series')
  async updateClientSeries(
    @Param('id', ParseIntPipe) id: number,
    @Param('clienteId', ParseIntPipe) clienteId: number,
    @Body()
    body: {
      series: Array<{
        tipoDoc: string;
        serie: string;
        correlativo?: number;
        activo?: boolean;
      }>;
    },
    @Request() req: any,
  ) {
    await this.resellerService.validateResellerAccess(
      req.user.id,
      req.user.rol,
      id,
    );
    return this.resellerService.upsertClientSeries(
      id,
      clienteId,
      body.series || [],
    );
  }
}
