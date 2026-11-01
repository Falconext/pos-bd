import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappConexionModule } from './whatsapp-conexion.module';
import { WhatsappConexionService } from './whatsapp-conexion.service';
import { NumeroNegocioService } from '../numero-negocio.service';
import { WhatsAppService } from '../whatsapp.service';

// El módulo se arma sin ciclos (NotificacionesModule ya importa WhatsAppModule)
// y WhatsAppService recibe el servicio del número del negocio.
describe('WhatsappConexionModule', () => {
  it('resuelve sus dependencias', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        WhatsappConexionModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    expect(mod.get(WhatsappConexionService)).toBeInstanceOf(
      WhatsappConexionService,
    );
    const wa = mod.get(WhatsAppService, { strict: false });
    expect((wa as any).numeroNegocio).toBeInstanceOf(NumeroNegocioService);
  });
});
