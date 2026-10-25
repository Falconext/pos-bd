import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ComprobanteModule } from '../../comprobante/comprobante.module';
import { IntegracionesModule } from '../../logistica/integraciones/integraciones.module';
import { EmisoresService } from '../emisores/emisores.service';
import { FacturacionApiController } from './facturacion.controller';
import { FacturacionApiService } from './facturacion.service';
import { AvisosFacturacionService } from './avisos.service';
import { MedidorApiService } from './medidor.service';

/**
 * La API pública de facturación.
 *
 * Importa `ComprobanteModule` en vez de reimplementar: un comprobante emitido
 * por la API y uno emitido desde el panel tienen que ser el mismo comprobante.
 * Una segunda implementación divergiría en el primer cambio tributario y
 * nadie se enteraría hasta que SUNAT rechazara.
 *
 * El motor de webhooks también se reusa —es el de logística, ya generalizado
 * por producto— por lo mismo: dos motores de entrega con reintentos y firma
 * HMAC es un motor que se arregla y otro que se olvida.
 */
import { ConsolaFacturacionController } from './consola.controller';
import { ConsolaFacturacionService } from './consola.service';
import { EmpresaModule } from '../../empresa/empresa.module';
import { MercadoPagoModule } from '../../mercadopago/mercadopago.module';
import { SuscripcionModule } from '../../suscripcion/suscripcion.module';
import { CobrosApiService } from './cobros-api.service';
import { ClienteModule } from '../../cliente/cliente.module';

@Module({
  imports: [PrismaModule, ComprobanteModule, IntegracionesModule, EmpresaModule, MercadoPagoModule, SuscripcionModule, ClienteModule],
  controllers: [FacturacionApiController, ConsolaFacturacionController],
  providers: [
    FacturacionApiService,
    EmisoresService,
    AvisosFacturacionService,
    MedidorApiService,
    ConsolaFacturacionService,
    CobrosApiService,
  ],
  exports: [
    FacturacionApiService,
    EmisoresService,
    AvisosFacturacionService,
    MedidorApiService,
  ],
})
export class FacturacionApiModule {}
