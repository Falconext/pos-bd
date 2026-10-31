import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ComprobanteModule } from '../comprobante/comprobante.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { LibroReclamacionesService } from './libro-reclamaciones.service';
import { LibroReclamacionesAvisosService } from './libro-reclamaciones-avisos.service';
import { LibroReclamacionesController } from './libro-reclamaciones.controller';
import { LibroReclamacionesPublicController } from './libro-reclamaciones-public.controller';

@Module({
  imports: [
    PrismaModule,
    NotificacionesModule,
    WhatsAppModule,
    // PdfGeneratorService compartido (un solo Chromium para todo el backend).
    forwardRef(() => ComprobanteModule),
  ],
  controllers: [
    LibroReclamacionesController,
    LibroReclamacionesPublicController,
  ],
  providers: [
    LibroReclamacionesService,
    LibroReclamacionesAvisosService,
    RolesGuard,
  ],
  exports: [LibroReclamacionesService],
})
export class LibroReclamacionesModule {}
